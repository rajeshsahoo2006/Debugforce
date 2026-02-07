import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const readFile = promisify(fs.readFile);

export interface SfCliResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface OrgUserInfo {
    userId: string;
    username: string;
    orgAlias?: string;
}

/**
 * Execute Salesforce CLI command using spawn (not exec) for safety
 */
export async function executeSfCli(
    args: string[],
    options: { cwd?: string } = {}
): Promise<SfCliResult> {
    return new Promise((resolve) => {
        const child = spawn('sf', args, {
            cwd: options.cwd || process.cwd(),
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('error', (error) => {
            resolve({
                success: false,
                stdout: '',
                stderr: error.message,
                exitCode: -1
            });
        });

        child.on('close', (code) => {
            resolve({
                success: code === 0,
                stdout,
                stderr,
                exitCode: code || 0
            });
        });
    });
}

/**
 * Get logged-in Salesforce user info
 */
export async function getLoggedInUser(): Promise<OrgUserInfo> {
    const result = await executeSfCli(['org', 'display', 'user', '--json']);

    if (!result.success) {
        if (result.stderr.includes('not found') || result.stderr.includes('command not found')) {
            throw new Error('Salesforce CLI (sf) is not installed or not in PATH. Please install it from https://developer.salesforce.com/tools/salesforcecli');
        }
        if (result.stderr.includes('No authorized orgs found') || result.stdout.includes('No authorized orgs')) {
            throw new Error('No authenticated Salesforce org found. Please run: sf org login web');
        }
        throw new Error(`Failed to get logged-in user: ${result.stderr || result.stdout}`);
    }

    try {
        const json = JSON.parse(result.stdout);
        
        // Handle different CLI output shapes
        const resultObj = json.result || json;
        
        if (!resultObj.id && !resultObj.userId) {
            throw new Error('Invalid response format: missing userId');
        }

        const userId = resultObj.id || resultObj.userId;
        const username = resultObj.username || resultObj.userName || '';
        const orgAlias = resultObj.alias || resultObj.orgAlias || resultObj.instanceUrl || undefined;

        if (!userId || !username) {
            throw new Error(`Invalid user info: userId=${userId}, username=${username}`);
        }

        return {
            userId,
            username,
            orgAlias
        };
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Failed to parse CLI output: ${result.stdout}`);
        }
        throw error;
    }
}

/**
 * Download Apex log using Salesforce CLI
 */
export async function downloadApexLog(logId: string, orgAlias?: string): Promise<string> {
    console.log(`Downloading Apex log: ${logId}${orgAlias ? ` (org: ${orgAlias})` : ''}`);
    
    const args = ['apex', 'log', 'get', '--log-id', logId, '--json'];
    if (orgAlias) {
        args.push('--target-org', orgAlias);
    }
    
    const result = await executeSfCli(args);

    console.log(`CLI command result - success: ${result.success}`);
    console.log(`CLI stdout: ${result.stdout.substring(0, 500)}`);
    if (result.stderr) {
        console.log(`CLI stderr: ${result.stderr.substring(0, 500)}`);
    }

    if (!result.success) {
        const errorOutput = result.stderr || result.stdout;
        console.error(`Failed to download log ${logId}: ${errorOutput}`);
        
        // Try to parse error details
        try {
            const errorJson = JSON.parse(errorOutput);
            const errorMsg = errorJson.message || errorJson.error || errorOutput;
            throw new Error(`Failed to download log ${logId}: ${errorMsg}`);
        } catch {
            throw new Error(`Failed to download log ${logId}: ${errorOutput}`);
        }
    }

    try {
        const json = JSON.parse(result.stdout);
        const fullJsonString = JSON.stringify(json, null, 2);
        console.log(`Parsed JSON response (first 2000 chars):`, fullJsonString.substring(0, 2000));
        console.log(`JSON keys:`, Object.keys(json).join(', '));
        if (json.result) {
            console.log(`json.result keys:`, Object.keys(json.result).join(', '));
        }
        
        // Handle different CLI output shapes
        const resultObj = json.result || json;
        
        // CLI might return the file path directly or in a nested structure
        let filePath: string | undefined;
        
        if (typeof resultObj === 'string') {
            filePath = resultObj;
            console.log(`File path from string resultObj: ${filePath}`);
        } else if (resultObj.path) {
            filePath = resultObj.path;
            console.log(`File path from resultObj.path: ${filePath}`);
        } else if (resultObj.filePath) {
            filePath = resultObj.filePath;
            console.log(`File path from resultObj.filePath: ${filePath}`);
        } else if (resultObj.location) {
            filePath = resultObj.location;
            console.log(`File path from resultObj.location: ${filePath}`);
        } else if (resultObj.log) {
            // Sometimes the log content is directly in the response
            if (typeof resultObj.log === 'string') {
                console.log(`Log content found directly in response`);
                return resultObj.log;
            } else if (resultObj.log.path) {
                filePath = resultObj.log.path;
                console.log(`File path from resultObj.log.path: ${filePath}`);
            } else if (resultObj.log.Body) {
                // Sometimes log content is in Body field
                console.log(`Log content found in resultObj.log.Body`);
                return resultObj.log.Body;
            }
        } else if (resultObj.Body) {
            // Log content might be directly in Body field
            console.log(`Log content found in resultObj.Body`);
            return resultObj.Body;
        } else if (json.status === 0 && resultObj) {
            // Sometimes the path is in stdout directly
            const lines = result.stdout.split('\n');
            for (const line of lines) {
                if (line.includes('/') && (line.includes('.log') || line.includes('apex'))) {
                    filePath = line.trim();
                    console.log(`File path extracted from stdout: ${filePath}`);
                    break;
                }
            }
        }

        if (!filePath) {
            // Try to find log file in common locations
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';
            const possiblePaths = [
                path.join(homeDir, '.sf', 'apex', `log_${logId}.log`),
                path.join(homeDir, '.sfdx', 'apex', `log_${logId}.log`),
                path.join(process.cwd(), `.sf`, 'apex', `log_${logId}.log`),
                path.join(homeDir, '.sf', 'apex', `${logId}.log`),
                path.join(homeDir, '.sfdx', 'apex', `${logId}.log`),
                // Also check for files without log_ prefix
                path.join(homeDir, '.sf', 'apex', `${logId}`),
                path.join(homeDir, '.sfdx', 'apex', `${logId}`)
            ];

            console.log(`Searching for log file in common locations...`);
            for (const possiblePath of possiblePaths) {
                try {
                    await fs.promises.access(possiblePath);
                    filePath = possiblePath;
                    console.log(`Found log file at: ${filePath}`);
                    break;
                } catch {
                    // Continue searching
                }
            }
        }

        if (!filePath) {
            // Last resort: check if the response itself contains the log content
            const fullResponse = JSON.stringify(json, null, 2);
            console.log(`Full CLI response: ${fullResponse.substring(0, 2000)}`);
            
            // Try multiple ways to find log content in the response
            let logContent: string | undefined;
            
            // Check various nested paths for log content
            if (json.log && typeof json.log === 'string') {
                logContent = json.log;
                console.log(`Found log content in json.log`);
            } else if (json.result?.log && typeof json.result.log === 'string') {
                logContent = json.result.log;
                console.log(`Found log content in json.result.log`);
            } else if (json.result?.Body && typeof json.result.Body === 'string') {
                logContent = json.result.Body;
                console.log(`Found log content in json.result.Body`);
            } else if (resultObj.Body && typeof resultObj.Body === 'string') {
                logContent = resultObj.Body;
                console.log(`Found log content in resultObj.Body`);
            } else if (json.result?.LogFileBody && typeof json.result.LogFileBody === 'string') {
                logContent = json.result.LogFileBody;
                console.log(`Found log content in json.result.LogFileBody`);
            } else if (resultObj.LogFileBody && typeof resultObj.LogFileBody === 'string') {
                logContent = resultObj.LogFileBody;
                console.log(`Found log content in resultObj.LogFileBody`);
            } else if (json.status === 0 && typeof resultObj === 'string' && resultObj.length > 100) {
                // Sometimes the entire response is the log content
                logContent = resultObj;
                console.log(`Found log content as direct string result`);
            }
            
            if (logContent) {
                console.log(`Successfully extracted log content (${logContent.length} characters)`);
                return logContent;
            }
            
            // If still no content, try to get the log directly without --json flag
            console.log(`Attempting alternative download method (without --json)...`);
            const altResult = await executeSfCli([
                'apex', 'log', 'get',
                '--log-id', logId,
                ...(orgAlias ? ['--target-org', orgAlias] : [])
            ]);
            
            if (altResult.success && altResult.stdout) {
                // Check if stdout contains the log content directly
                const stdoutContent = altResult.stdout.trim();
                // If it's a long string and doesn't look like JSON or an error, it's probably the log
                if (stdoutContent.length > 100 && 
                    !stdoutContent.startsWith('{') && 
                    !stdoutContent.startsWith('[') &&
                    !stdoutContent.includes('"status"') &&
                    !stdoutContent.toLowerCase().includes('error')) {
                    console.log(`Found log content in stdout (${stdoutContent.length} characters)`);
                    return stdoutContent;
                }
            }
            
            // Log the full response for debugging
            const outputChannel = vscode.window.createOutputChannel('Debugforce');
            outputChannel.appendLine(`=== CLI Response Debug ===`);
            outputChannel.appendLine(`Full JSON response: ${fullResponse}`);
            outputChannel.appendLine(`Response keys: ${Object.keys(json).join(', ')}`);
            if (json.result) {
                outputChannel.appendLine(`Result keys: ${Object.keys(json.result).join(', ')}`);
                outputChannel.appendLine(`Result type: ${typeof json.result}`);
            }
            outputChannel.show();
            
            console.error(`Could not determine log file path or content. Full response:`, fullResponse);
            throw new Error(`Could not determine log file path from CLI output. Response keys: ${Object.keys(json).join(', ')}. Check the Debugforce output channel for full response.`);
        }

        // Read the file content
        console.log(`Reading log file from: ${filePath}`);
        const content = await readFile(filePath, 'utf-8');
        console.log(`Successfully read ${content.length} characters from log file`);
        return content;
    } catch (error) {
        if (error instanceof SyntaxError) {
            console.error(`JSON parsing failed. stdout: ${result.stdout.substring(0, 500)}`);
            // If JSON parsing fails, try to extract path from stdout
            const lines = result.stdout.split('\n');
            for (const line of lines) {
                if (line.includes('/') && (line.includes('.log') || line.includes('apex'))) {
                    try {
                        console.log(`Trying to read from extracted path: ${line.trim()}`);
                        const content = await readFile(line.trim(), 'utf-8');
                        return content;
                    } catch {
                        // Continue searching
                    }
                }
            }
            throw new Error(`Failed to parse CLI output and locate log file. Output: ${result.stdout.substring(0, 500)}`);
        }
        throw error;
    }
}
