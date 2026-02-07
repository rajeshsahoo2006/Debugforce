import * as vscode from 'vscode';
import { queryApexLogs, McpSoqlResult } from './mcp';
import { getSFCLILoggedInUserId } from './userContext';

export interface ApexLogEntry {
    id: string;
    logUserId: string;
    operation: string;
    startTime: string;
    durationMilliseconds: number;
    logLength: number;
}

/**
 * Fetch Apex logs for the logged-in user from the last N minutes
 */
export async function fetchLogs(timeWindowMinutes: number, maxLogs: number): Promise<ApexLogEntry[]> {
    const userId = await getSFCLILoggedInUserId();
    const outputChannel = vscode.window.createOutputChannel('Debugforce');
    
    // Calculate UTC timestamp N minutes ago
    const nMinutesAgo = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
    const startTimeIso = nMinutesAgo.toISOString();
    
    // Build SOQL date literal - Salesforce requires format: YYYY-MM-DDTHH:mm:ss+00:00
    // Remove milliseconds and ensure timezone format
    const startTimeSoql = startTimeIso.replace(/\.\d{3}Z$/, '+00:00');
    
    console.log(`Fetching logs for userId: ${userId}, timeWindow: ${timeWindowMinutes} minutes, startTime: ${startTimeSoql}`);
    
    // Log to output channel
    outputChannel.appendLine(`=== Fetching Logs ===`);
    outputChannel.appendLine(`UserId: ${userId}`);
    outputChannel.appendLine(`Time window: ${timeWindowMinutes} minutes`);
    outputChannel.appendLine(`Start time: ${startTimeSoql}`);
    outputChannel.appendLine(`Current time: ${new Date().toISOString()}`);
    
    let result: McpSoqlResult;
    
    try {
        result = await queryApexLogs(userId, startTimeSoql, maxLogs);
        outputChannel.appendLine(`Query returned ${result.records?.length || 0} record(s)`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`✗ Query failed: ${message}`);
        outputChannel.show();
        throw new Error(`Failed to query logs: ${message}`);
    }

    // Defensive check: filter out any records that don't match our userId
    const logs: ApexLogEntry[] = [];
    
    if (!result.records || result.records.length === 0) {
        outputChannel.appendLine('No logs found. Make sure you have:');
        outputChannel.appendLine('1. Set up debug logging (TraceFlag created)');
        outputChannel.appendLine('2. Performed actions in Salesforce that generate logs');
        outputChannel.appendLine('3. The time window covers when activity occurred');
        outputChannel.show();
    }
    
    for (const record of result.records || []) {
        // Defensive check: ensure LogUserId matches
        if (record.LogUserId !== userId) {
            outputChannel.appendLine(`⚠ Discarded log entry with mismatched LogUserId: ${record.LogUserId} (expected: ${userId})`);
            vscode.window.showWarningMessage(
                `Debugforce: Discarded log entry with mismatched LogUserId: ${record.LogUserId} (expected: ${userId})`
            );
            continue;
        }

        if (!record.Id) {
            continue; // Skip invalid records
        }

        logs.push({
            id: record.Id,
            logUserId: record.LogUserId || userId,
            operation: record.Operation || 'Unknown',
            startTime: record.StartTime || '',
            durationMilliseconds: record.DurationMilliseconds || 0,
            logLength: record.LogLength || 0
        });
    }

    outputChannel.appendLine(`✓ Found ${logs.length} valid log(s) for user ${userId}`);
    
    // Log each log entry for debugging
    logs.forEach((log, index) => {
        outputChannel.appendLine(`  Log ${index + 1}: ${log.id} - ${log.operation} - ${log.startTime}`);
    });

    return logs;
}
