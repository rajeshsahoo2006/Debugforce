import * as vscode from 'vscode';
import { executeSfCli } from './sfCli';

// Output channel for logging (will be set by extension.ts)
let outputChannel: vscode.OutputChannel | undefined;

export function setOutputChannel(channel: vscode.OutputChannel) {
    outputChannel = channel;
}

function log(message: string) {
    if (outputChannel) {
        outputChannel.appendLine(message);
    }
    console.log(message);
}

function logError(message: string) {
    if (outputChannel) {
        outputChannel.appendLine(`ERROR: ${message}`);
    }
    console.error(message);
}

/**
 * Setup debug logging by creating/updating TraceFlag and DebugLevel
 */
export async function setupDebugLogging(userId: string, traceMinutes: number): Promise<void> {
    log(`Starting debug logging setup for user ${userId}`);
    
    // Step 1: Query or create DebugLevel
    let debugLevelId: string;
    
    const queryDebugLevel = await executeSfCli([
        'data', 'query',
        '--query', `SELECT Id, DeveloperName FROM DebugLevel WHERE DeveloperName='CLI_Debug' LIMIT 1`,
        '--use-tooling-api',
        '--json'
    ]);

    if (queryDebugLevel.success) {
        try {
            const json = JSON.parse(queryDebugLevel.stdout);
            const resultObj = json.result || json;
            const records = resultObj.records || [];
            
            if (records.length > 0 && records[0].Id) {
                debugLevelId = records[0].Id;
                log(`Found existing DebugLevel: ${debugLevelId}`);
            } else {
                // Create DebugLevel
                log('Creating new DebugLevel...');
                debugLevelId = await createDebugLevel();
                log(`Created DebugLevel: ${debugLevelId}`);
            }
        } catch {
            debugLevelId = await createDebugLevel();
        }
    } else {
        debugLevelId = await createDebugLevel();
    }

    // Step 2: Delete existing TraceFlags for this user
    log('Cleaning up existing TraceFlags...');
    await cleanupTraceFlags(userId);

    // Step 3: Create new TraceFlag
    log('Creating new TraceFlag...');
    const now = new Date();
    const expirationDate = new Date(now.getTime() + traceMinutes * 60 * 1000);
    
    // Format dates for Salesforce API (YYYY-MM-DDTHH:mm:ss+00:00)
    const startDateIso = now.toISOString().replace('Z', '+00:00');
    const expirationDateIso = expirationDate.toISOString().replace('Z', '+00:00');

    // Use --json flag with proper field mapping
    // Salesforce CLI data create record expects values in format: Field=Value Field2=Value2
    // Dates need to be properly quoted if they contain spaces
    const createTraceFlag = await executeSfCli([
        'data', 'create', 'record',
        '--sobject', 'TraceFlag',
        '--values', `TracedEntityId=${userId} LogType=DEVELOPER_LOG DebugLevelId=${debugLevelId} StartDate=${startDateIso} ExpirationDate=${expirationDateIso}`,
        '--use-tooling-api',
        '--json'
    ]);

    if (!createTraceFlag.success) {
        // Show detailed error information
        const errorOutput = createTraceFlag.stderr || createTraceFlag.stdout;
        logError('TraceFlag creation failed');
        logError(`UserId: ${userId}`);
        logError(`DebugLevelId: ${debugLevelId}`);
        logError(`StartDate: ${startDateIso}`);
        logError(`ExpirationDate: ${expirationDateIso}`);
        logError(`Error output: ${errorOutput}`);
        
        // Try to parse error details from JSON output
        try {
            const errorJson = JSON.parse(errorOutput);
            const errorMsg = errorJson.message || errorJson.error || errorOutput;
            throw new Error(`Failed to create TraceFlag: ${errorMsg}`);
        } catch {
            throw new Error(`Failed to create TraceFlag: ${errorOutput}`);
        }
    }

    // Verify TraceFlag was created successfully
    try {
        const resultJson = JSON.parse(createTraceFlag.stdout);
        const resultObj = resultJson.result || resultJson;
        const traceFlagId = resultObj.id || resultObj.Id;
        if (traceFlagId) {
            log(`✓ TraceFlag created successfully: ${traceFlagId}`);
        } else if (!resultObj.success) {
            throw new Error(`TraceFlag creation returned no ID: ${createTraceFlag.stdout}`);
        }
    } catch (parseError) {
        // If parsing fails, check if stdout contains success indicators
        if (!createTraceFlag.stdout.includes('id') && !createTraceFlag.stdout.includes('success')) {
            logError(`Failed to verify TraceFlag creation: ${createTraceFlag.stdout}`);
            throw new Error(`Failed to verify TraceFlag creation: ${createTraceFlag.stdout}`);
        } else {
            log('TraceFlag creation appears successful (unable to parse ID)');
        }
    }

    vscode.window.showInformationMessage(
        `Debugforce: Debug logging enabled for ${traceMinutes} minutes`
    );
}

/**
 * Create DebugLevel named CLI_Debug
 */
async function createDebugLevel(): Promise<string> {
    // Use underscore in MasterLabel to avoid space parsing issues
    // MasterLabel and DeveloperName can be the same value
    const create = await executeSfCli([
        'data', 'create', 'record',
        '--sobject', 'DebugLevel',
        '--values', 'MasterLabel=CLI_Debug DeveloperName=CLI_Debug ApexCode=FINEST ApexProfiling=FINEST Database=FINEST Workflow=FINEST Validation=FINEST System=DEBUG DataAccess=FINEST',
        '--use-tooling-api',
        '--json'
    ]);

    if (!create.success) {
        const errorOutput = create.stderr || create.stdout;
        logError(`DebugLevel creation failed: ${errorOutput}`);
        
        // Try to parse error details
        try {
            const errorJson = JSON.parse(errorOutput);
            const errorMsg = errorJson.message || errorJson.error || errorOutput;
            throw new Error(`Failed to create DebugLevel: ${errorMsg}`);
        } catch {
            throw new Error(`Failed to create DebugLevel: ${errorOutput}`);
        }
    }

    try {
        const json = JSON.parse(create.stdout);
        const resultObj = json.result || json;
        
        // Handle different response formats
        const debugLevelId = resultObj.id || resultObj.Id || resultObj.result?.id;
        
        if (debugLevelId) {
            return debugLevelId;
        }
        
        // If no ID in result, check if it's in a different format
        console.error('DebugLevel creation response:', create.stdout);
        throw new Error(`DebugLevel created but no ID returned. Response: ${create.stdout}`);
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Failed to parse DebugLevel creation result: ${create.stdout}`);
        }
        throw error;
    }
}

/**
 * Cleanup TraceFlags for a specific user
 */
export async function cleanupTraceFlags(userId: string): Promise<void> {
    const query = await executeSfCli([
        'data', 'query',
        '--query', `SELECT Id FROM TraceFlag WHERE TracedEntityId='${userId}' AND LogType='DEVELOPER_LOG'`,
        '--use-tooling-api',
        '--json'
    ]);

    if (!query.success) {
        // If query fails, it might mean no trace flags exist - that's okay
        return;
    }

    try {
        const json = JSON.parse(query.stdout);
        const resultObj = json.result || json;
        const records = resultObj.records || [];

        // Delete each TraceFlag
        for (const record of records) {
            if (record.Id) {
                await executeSfCli([
                    'data', 'delete', 'record',
                    '--sobject', 'TraceFlag',
                    '--record-id', record.Id,
                    '--use-tooling-api',
                    '--json'
                ]);
            }
        }

        if (records.length > 0) {
            vscode.window.showInformationMessage(
                `Debugforce: Cleaned up ${records.length} trace flag(s)`
            );
        }
    } catch (error) {
        // If parsing fails, assume no trace flags exist
        if (!(error instanceof SyntaxError)) {
            throw error;
        }
    }
}
