import * as vscode from 'vscode';
import { fetchLogs } from './logQuery';
import { downloadRawLog } from './rawLogDownload';
import { getCurrentUser } from './userContext';
import * as path from 'path';
import * as fs from 'fs';

let backgroundInterval: NodeJS.Timeout | undefined;
let setupTimestamp: number | undefined;
let traceDurationMinutes: number = 30;

const BACKGROUND_FETCH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Start background automatic log fetching
 */
export function startBackgroundTask(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    logTreeProvider: any,
    traceMinutes: number
): void {
    // Stop any existing background task
    stopBackgroundTask();

    setupTimestamp = Date.now();
    traceDurationMinutes = traceMinutes;

    outputChannel.appendLine(`=== Starting Background Log Fetching ===`);
    outputChannel.appendLine(`Trace duration: ${traceMinutes} minutes`);
    outputChannel.appendLine(`Fetch interval: ${BACKGROUND_FETCH_INTERVAL_MS / 1000 / 60} minutes`);

    // Store setup timestamp in extension context
    context.globalState.update('debugforce.setupTimestamp', setupTimestamp);
    context.globalState.update('debugforce.traceDurationMinutes', traceMinutes);

    // Start the interval
    backgroundInterval = setInterval(async () => {
        await performBackgroundFetch(context, outputChannel, logTreeProvider);
    }, BACKGROUND_FETCH_INTERVAL_MS);

    // Perform initial fetch after a short delay
    setTimeout(async () => {
        await performBackgroundFetch(context, outputChannel, logTreeProvider);
    }, 30000); // Wait 30 seconds before first fetch

    outputChannel.appendLine('✓ Background task started');
}

/**
 * Stop background automatic log fetching
 */
export function stopBackgroundTask(): void {
    if (backgroundInterval) {
        clearInterval(backgroundInterval);
        backgroundInterval = undefined;
    }
    setupTimestamp = undefined;
}

/**
 * Check if background task is running
 */
export function isBackgroundTaskRunning(): boolean {
    return backgroundInterval !== undefined;
}

/**
 * Perform background fetch and analysis
 */
async function performBackgroundFetch(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    logTreeProvider: any
): Promise<void> {
    try {
        // Check if trace has expired
        const storedTimestamp = context.globalState.get<number>('debugforce.setupTimestamp');
        const storedDuration = context.globalState.get<number>('debugforce.traceDurationMinutes', 30);
        
        if (storedTimestamp) {
            const elapsedMinutes = (Date.now() - storedTimestamp) / (60 * 1000);
            if (elapsedMinutes >= storedDuration) {
                outputChannel.appendLine(`⏰ Trace expired (${elapsedMinutes.toFixed(1)} minutes elapsed). Stopping background task.`);
                stopBackgroundTask();
                return;
            }
        }

        const config = vscode.workspace.getConfiguration('debugforce');
        const timeWindowMinutes = config.get<number>('timeWindowMinutes', 30);
        const maxLogs = config.get<number>('maxLogs', 50);
        const rawLogsFolder = config.get<string>('rawLogsFolder', '.debugforce/logs');

        outputChannel.appendLine(`\n[Background] Fetching logs...`);

        // Fetch logs
        const logs = await fetchLogs(timeWindowMinutes, maxLogs);
        
        if (logs.length === 0) {
            outputChannel.appendLine(`[Background] No new logs found`);
            return;
        }

        outputChannel.appendLine(`[Background] Found ${logs.length} log(s)`);

        // Download raw logs
        const userInfo = await getCurrentUser();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            outputChannel.appendLine(`[Background] No workspace folder found`);
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const logsDir = path.join(workspaceRoot, rawLogsFolder);

        // Ensure logs directory exists
        await fs.promises.mkdir(logsDir, { recursive: true });

        // Download each log
        let downloadedCount = 0;
        for (const log of logs) {
            try {
                const logFilePath = path.join(logsDir, `${log.id}.log`);
                
                // Skip if already downloaded
                try {
                    await fs.promises.access(logFilePath);
                    continue; // File already exists
                } catch {
                    // File doesn't exist, proceed to download
                }

                await downloadRawLog(log.id, userInfo.orgAlias, rawLogsFolder);
                downloadedCount++;
            } catch (error) {
                outputChannel.appendLine(`[Background] Failed to download log ${log.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (downloadedCount > 0) {
            outputChannel.appendLine(`[Background] Downloaded ${downloadedCount} new log file(s)`);
        }

        // Update tree view
        if (logTreeProvider && typeof logTreeProvider.refresh === 'function') {
            logTreeProvider.refresh(logs);
        }

        // Show notification if new logs were downloaded
        if (downloadedCount > 0) {
            vscode.window.showInformationMessage(
                `Debugforce: Downloaded ${downloadedCount} new log(s). Use "Analyze All Logs" to review.`,
                'Analyze Now'
            ).then(selection => {
                if (selection === 'Analyze Now') {
                    vscode.commands.executeCommand('debugforce.analyzeWithAgentforce');
                }
            });
        }

    } catch (error) {
        outputChannel.appendLine(`[Background] Error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Resume background task from stored state (on extension activation)
 */
export function resumeBackgroundTaskIfNeeded(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
    logTreeProvider: any
): void {
    const storedTimestamp = context.globalState.get<number>('debugforce.setupTimestamp');
    const storedDuration = context.globalState.get<number>('debugforce.traceDurationMinutes', 30);

    if (!storedTimestamp) {
        return; // No background task was running
    }

    const elapsedMinutes = (Date.now() - storedTimestamp) / (60 * 1000);
    
    if (elapsedMinutes >= storedDuration) {
        // Trace expired, clean up
        context.globalState.update('debugforce.setupTimestamp', undefined);
        context.globalState.update('debugforce.traceDurationMinutes', undefined);
        outputChannel.appendLine(`[Background] Previous trace expired (${elapsedMinutes.toFixed(1)} minutes elapsed)`);
        return;
    }

    // Resume background task
    const remainingMinutes = storedDuration - elapsedMinutes;
    outputChannel.appendLine(`[Background] Resuming background task (${remainingMinutes.toFixed(1)} minutes remaining)`);
    startBackgroundTask(context, outputChannel, logTreeProvider, storedDuration);
}
