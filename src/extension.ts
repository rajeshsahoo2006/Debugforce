import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LogTreeDataProvider, LogTreeItem } from './treeView';
import { getCurrentUser, getSFCLILoggedInUserId, clearUserCache } from './userContext';
import { fetchLogs } from './logQuery';
import { downloadLog } from './logDownload';
import { generateAnalysisPacket } from './markdown';
import { downloadRawLog } from './rawLogDownload';
import { setupDebugLogging, cleanupTraceFlags, setOutputChannel } from './traceFlags';
import { runDiagnostics } from './diagnostics';
import { DebugforceWebviewPanel } from './webviewPanel';

let logTreeProvider: LogTreeDataProvider;
let logTreeView: vscode.TreeView<LogTreeItem>;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('Debugforce');
    outputChannel.appendLine('Debugforce extension activated');
    
    // Set output channel for trace flags module
    setOutputChannel(outputChannel);
    // Initialize tree view
    logTreeProvider = new LogTreeDataProvider();
    logTreeView = vscode.window.createTreeView('debugforceLogs', {
        treeDataProvider: logTreeProvider,
        showCollapseAll: false
    });

    // Status bar button
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = '$(debug) Debugforce';
    statusBarItem.tooltip = 'Click to open Debugforce Control Panel';
    statusBarItem.command = 'debugforce.showControlPanel';
    statusBarItem.show();

    // Register commands
    const commands = [
        vscode.commands.registerCommand('debugforce.setupDebugLogging', async () => {
            await handleSetupDebugLogging();
        }),
        vscode.commands.registerCommand('debugforce.fetchLogs', async () => {
            await handleFetchLogs();
        }),
        vscode.commands.registerCommand('debugforce.downloadLog', async (item?: LogTreeItem | string) => {
            outputChannel.appendLine(`=== Download Log Command Called ===`);
            outputChannel.appendLine(`Item type: ${item ? (typeof item === 'string' ? 'string' : 'LogTreeItem') : 'undefined'}`);
            outputChannel.appendLine(`Item value: ${item ? (typeof item === 'string' ? item : item.logEntry.id) : 'undefined'}`);
            
            let logItem: LogTreeItem | undefined;
            
            // Handle different call scenarios
            if (item instanceof LogTreeItem) {
                logItem = item;
                outputChannel.appendLine(`✓ Using LogTreeItem directly: ${logItem.logEntry.id}`);
            } else if (typeof item === 'string') {
                // If logId string is passed, find the log entry
                const logs = logTreeProvider.getLogs();
                outputChannel.appendLine(`Looking up logId: ${item}`);
                outputChannel.appendLine(`Provider has ${logs.length} logs: ${logs.map(l => l.id).join(', ')}`);
                const logEntry = logs.find(log => log.id === item);
                if (logEntry) {
                    logItem = new LogTreeItem(logEntry, vscode.TreeItemCollapsibleState.None);
                    outputChannel.appendLine(`✓ Created LogTreeItem for logId: ${item}`);
                } else {
                    outputChannel.appendLine(`✗ Log entry not found for logId: ${item}`);
                    outputChannel.appendLine(`Available log IDs: ${logs.map(l => l.id).join(', ')}`);
                }
            }
            
            // If still no item, try to get from tree view selection
            if (!logItem) {
                outputChannel.appendLine(`No item from arguments, checking tree view selection...`);
                const selection = logTreeView.selection;
                outputChannel.appendLine(`Tree view selection: ${selection.length} items`);
                if (selection && selection.length > 0) {
                    logItem = selection[0];
                    outputChannel.appendLine(`✓ Using selected item from tree view: ${logItem.logEntry.id}`);
                } else {
                    // Try to get active selection from tree view
                    outputChannel.appendLine(`No selection found, checking if tree view is visible...`);
                }
            }
            
            if (!logItem) {
                const logs = logTreeProvider.getLogs();
                outputChannel.appendLine(`✗ No log item found`);
                outputChannel.appendLine(`Available logs in provider: ${logs.length}`);
                if (logs.length > 0) {
                    outputChannel.appendLine(`Log IDs: ${logs.map(l => l.id).join(', ')}`);
                    // If there's only one log, use it automatically
                    if (logs.length === 1) {
                        outputChannel.appendLine(`Only one log available, using it automatically`);
                        logItem = new LogTreeItem(logs[0], vscode.TreeItemCollapsibleState.None);
                    }
                }
                
                if (!logItem) {
                    outputChannel.show();
                    vscode.window.showErrorMessage(`Debugforce: Please select a log entry from the tree view. Found ${logs.length} log(s) in provider.`);
                    return;
                }
            }
            
            outputChannel.appendLine(`✓ Proceeding with download for logId: ${logItem.logEntry.id}`);
            await handleDownloadLog(logItem);
        }),
        vscode.commands.registerCommand('debugforce.cleanupTraceFlags', async () => {
            await handleCleanupTraceFlags();
        }),
        vscode.commands.registerCommand('debugforce.runDiagnostics', async () => {
            await handleRunDiagnostics();
        }),
        vscode.commands.registerCommand('debugforce.testQuery', async () => {
            await handleTestQuery();
        }),
        vscode.commands.registerCommand('debugforce.showControlPanel', () => {
            DebugforceWebviewPanel.createOrShow(logTreeProvider);
        })
    ];

    context.subscriptions.push(...commands, statusBarItem);
}

async function handleSetupDebugLogging() {
    try {
        const config = vscode.workspace.getConfiguration('debugforce');
        const traceMinutes = config.get<number>('traceMinutes', 30);
        
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Debugforce: Setting up debug logging...',
                cancellable: false
            },
            async () => {
                try {
                    const userId = await getSFCLILoggedInUserId();
                    outputChannel.appendLine(`Setting up debug logging for userId: ${userId}`);
                    outputChannel.appendLine(`Trace duration: ${traceMinutes} minutes`);
                    await setupDebugLogging(userId, traceMinutes);
                    outputChannel.appendLine('✓ Debug logging setup completed successfully');
                } catch (error) {
                    outputChannel.appendLine(`✗ Error: ${error instanceof Error ? error.message : String(error)}`);
                    throw error;
                }
            }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Setup debug logging error:', error);
        vscode.window.showErrorMessage(`Debugforce: Failed to setup debug logging: ${message}`, 'Show Details').then(selection => {
            if (selection === 'Show Details') {
                vscode.window.showErrorMessage(`Full error: ${message}`, { modal: true });
            }
        });
    }
}

async function handleFetchLogs() {
    try {
        const config = vscode.workspace.getConfiguration('debugforce');
        const timeWindowMinutes = config.get<number>('timeWindowMinutes', 30);
        const maxLogs = config.get<number>('maxLogs', 50);
        const rawLogsFolder = config.get<string>('rawLogsFolder', '.debugforce/logs');

        outputChannel.appendLine('=== Fetching Logs ===');
        
        // Clean up existing log files before fetching new ones
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                const logsDir = path.join(workspaceRoot, rawLogsFolder);
                
                // Check if directory exists and has log files
                try {
                    const files = await fs.promises.readdir(logsDir);
                    const logFiles = files.filter((f: string) => f.endsWith('.log'));
                    
                    if (logFiles.length > 0) {
                        outputChannel.appendLine(`Found ${logFiles.length} existing log file(s), deleting...`);
                        for (const file of logFiles) {
                            const filePath = path.join(logsDir, file);
                            await fs.promises.unlink(filePath);
                            outputChannel.appendLine(`  Deleted: ${file}`);
                        }
                        outputChannel.appendLine('✓ Existing logs cleaned up');
                    }
                } catch (error) {
                    // Directory doesn't exist or can't be read - that's okay
                    outputChannel.appendLine('No existing logs to clean up');
                }
            }
        } catch (error) {
            outputChannel.appendLine(`⚠ Warning: Could not clean up existing logs: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        outputChannel.show();

        // Show progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Debugforce: Fetching logs...',
                cancellable: false
            },
            async () => {
                const logs = await fetchLogs(timeWindowMinutes, maxLogs);
                
                outputChannel.appendLine(`fetchLogs returned ${logs.length} log(s)`);
                
                if (logs.length === 0) {
                    const message = `Debugforce: No logs found for the last ${timeWindowMinutes} minutes. Make sure you have:\n1. Set up debug logging\n2. Performed actions in Salesforce\n3. The time window covers when activity occurred`;
                    outputChannel.appendLine(message);
                    outputChannel.show();
                    vscode.window.showWarningMessage(
                        `Debugforce: No logs found for the last ${timeWindowMinutes} minutes`
                    );
                } else {
                    outputChannel.appendLine(`✓ Found ${logs.length} log(s), refreshing tree view...`);
                    // Log each log ID for debugging
                    logs.forEach((log, index) => {
                        outputChannel.appendLine(`  Log ${index + 1}: ${log.id} - ${log.operation}`);
                    });
                    vscode.window.showInformationMessage(
                        `Debugforce: Found ${logs.length} log(s)`
                    );
                }
                
                outputChannel.appendLine(`Calling logTreeProvider.refresh with ${logs.length} logs`);
                if (logs.length > 0) {
                    outputChannel.appendLine(`First log details: id=${logs[0].id}, operation=${logs[0].operation}`);
                }
                logTreeProvider.refresh(logs);
                const providerLogs = logTreeProvider.getLogs();
                outputChannel.appendLine(`Tree view refreshed. Provider now has ${providerLogs.length} logs`);
                if (providerLogs.length > 0) {
                    outputChannel.appendLine(`Provider first log: id=${providerLogs[0].id}`);
                } else {
                    outputChannel.appendLine(`⚠ WARNING: Provider has 0 logs after refresh!`);
                }
                
                // Update webview panel if it's open
                DebugforceWebviewPanel.createOrShow(logTreeProvider);
            }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`✗ Failed to fetch logs: ${message}`);
        outputChannel.show();
        vscode.window.showErrorMessage(`Debugforce: Failed to fetch logs: ${message}`);
    }
}

async function handleDownloadLog(item: LogTreeItem) {
    try {
        const logId = item.logEntry.id;
        outputChannel.appendLine(`=== Downloading Log ===`);
        outputChannel.appendLine(`Log ID: ${logId}`);
        outputChannel.appendLine(`Operation: ${item.logEntry.operation}`);
        outputChannel.show();
        
        const config = vscode.workspace.getConfiguration('debugforce');
        const timeWindowMinutes = config.get<number>('timeWindowMinutes', 30);
        const outputFolder = config.get<string>('outputFolder', '.debugforce/analysis');
        const truncateRawLogBytes = config.get<number>('truncateRawLogBytes', 1500000);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Debugforce: Downloading log ${logId}...`,
                cancellable: false
            },
            async () => {
                try {
                    // Get user info first to get org alias
                    outputChannel.appendLine('Getting user info...');
                    const userInfo = await getCurrentUser();
                    outputChannel.appendLine(`  UserId: ${userInfo.userId}`);
                    outputChannel.appendLine(`  Username: ${userInfo.username}`);
                    outputChannel.appendLine(`  Org Alias: ${userInfo.orgAlias || 'N/A'}`);
                    
                    // Download log (with org alias if available)
                    outputChannel.appendLine(`Calling downloadLog for logId: ${logId}${userInfo.orgAlias ? ` (org: ${userInfo.orgAlias})` : ''}...`);
                    const logContent = await downloadLog(logId, userInfo.orgAlias);
                    outputChannel.appendLine(`✓ Log downloaded successfully`);
                    outputChannel.appendLine(`  Content length: ${logContent.length} characters`);
                    outputChannel.appendLine(`  First 200 chars: ${logContent.substring(0, 200)}`);
                    
                    // Download raw log file with original name
                    outputChannel.appendLine('Saving raw log file...');
                    const rawLogPath = await downloadRawLog(logId, userInfo.orgAlias, '.debugforce/logs');
                    outputChannel.appendLine(`✓ Raw log saved: ${rawLogPath}`);
                    
                    // Generate analysis packet
                    outputChannel.appendLine('Generating analysis packet...');
                    const filePath = await generateAnalysisPacket({
                        userInfo,
                        logId,
                        timeWindowMinutes,
                        logContent,
                        outputFolder,
                        truncateRawLogBytes
                    });
                    outputChannel.appendLine(`✓ Analysis packet created: ${filePath}`);

                    // Open the file
                    outputChannel.appendLine('Opening analysis packet...');
                    const document = await vscode.workspace.openTextDocument(filePath);
                    await vscode.window.showTextDocument(document);
                    outputChannel.appendLine(`✓ Analysis packet opened in editor`);

                    vscode.window.showInformationMessage(
                        `Debugforce: Analysis packet created: ${filePath}`
                    );
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    outputChannel.appendLine(`✗ Error during download: ${errorMessage}`);
                    if (error instanceof Error && error.stack) {
                        outputChannel.appendLine(`Stack trace: ${error.stack}`);
                    }
                    outputChannel.show();
                    throw error;
                }
            }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`✗ Failed to download log: ${message}`);
        if (error instanceof Error && error.stack) {
            outputChannel.appendLine(`Stack trace: ${error.stack}`);
        }
        outputChannel.show();
        vscode.window.showErrorMessage(`Debugforce: Failed to download log: ${message}`);
    }
}

async function handleCleanupTraceFlags() {
    try {
        const userId = await getSFCLILoggedInUserId();
        await cleanupTraceFlags(userId);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Debugforce: Failed to cleanup trace flags: ${message}`);
    }
}

async function handleRunDiagnostics() {
    try {
        const diagnostics = await runDiagnostics();
        
        // Show in output channel
        const outputChannel = vscode.window.createOutputChannel('Debugforce Diagnostics');
        outputChannel.clear();
        outputChannel.append(diagnostics);
        outputChannel.show();
        
        // Also show in a document
        const doc = await vscode.workspace.openTextDocument({
            content: diagnostics,
            language: 'plaintext'
        });
        await vscode.window.showTextDocument(doc);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Debugforce: Diagnostics failed: ${message}`);
    }
}

async function handleTestQuery() {
    try {
        outputChannel.appendLine('=== Testing SOQL Query ===');
        outputChannel.show();
        
        const userId = await getSFCLILoggedInUserId();
        outputChannel.appendLine(`UserId: ${userId}`);
        
        // Test with a longer time window (last 60 minutes)
        const timeWindowMinutes = 60;
        const nMinutesAgo = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
        const startTimeIso = nMinutesAgo.toISOString();
        const startTimeSoql = startTimeIso.replace(/\.\d{3}Z$/, '+00:00');
        
        outputChannel.appendLine(`Time window: ${timeWindowMinutes} minutes`);
        outputChannel.appendLine(`Start time: ${startTimeSoql}`);
        
        const { queryApexLogs } = await import('./mcp');
        const result = await queryApexLogs(userId, startTimeSoql, 100);
        
        outputChannel.appendLine(`Query returned ${result.records?.length || 0} records`);
        
        if (result.records && result.records.length > 0) {
            result.records.forEach((record, index) => {
                outputChannel.appendLine(`Record ${index + 1}:`);
                outputChannel.appendLine(`  Id: ${record.Id}`);
                outputChannel.appendLine(`  LogUserId: ${record.LogUserId}`);
                outputChannel.appendLine(`  Operation: ${record.Operation}`);
                outputChannel.appendLine(`  StartTime: ${record.StartTime}`);
            });
        } else {
            outputChannel.appendLine('No records found. Possible reasons:');
            outputChannel.appendLine('1. No debug logging set up (TraceFlag missing)');
            outputChannel.appendLine('2. No activity in Salesforce in the last 60 minutes');
            outputChannel.appendLine('3. Logs exist but for a different user');
        }
        
        outputChannel.show();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`✗ Test query failed: ${message}`);
        outputChannel.show();
        vscode.window.showErrorMessage(`Debugforce: Test query failed: ${message}`);
    }
}

export function deactivate() {
    // Cleanup if needed
}
