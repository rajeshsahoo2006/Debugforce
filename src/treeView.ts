import * as vscode from 'vscode';
import { ApexLogEntry } from './logQuery';

export class LogTreeDataProvider implements vscode.TreeDataProvider<LogTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<LogTreeItem | undefined | null | void> = new vscode.EventEmitter<LogTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<LogTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private logs: ApexLogEntry[] = [];
    
    // Expose logs for external access
    getLogs(): ApexLogEntry[] {
        return this.logs;
    }

    refresh(logs: ApexLogEntry[]): void {
        console.log(`LogTreeDataProvider.refresh called with ${logs?.length || 0} logs`);
        if (logs && logs.length > 0) {
            console.log(`First log in refresh: ${logs[0].id}`);
        }
        
        // Merge new logs with existing logs (don't replace, append new ones)
        // Keep unique logs by ID
        const existingLogIds = new Set(this.logs.map(log => log.id));
        const newLogs = (logs || []).filter(log => !existingLogIds.has(log.id));
        
        if (newLogs.length > 0) {
            console.log(`Adding ${newLogs.length} new logs to existing ${this.logs.length} logs`);
            this.logs = [...this.logs, ...newLogs];
            // Sort by StartTime descending (newest first)
            this.logs.sort((a, b) => {
                const timeA = new Date(a.startTime).getTime();
                const timeB = new Date(b.startTime).getTime();
                return timeB - timeA;
            });
        } else if (logs && logs.length > 0) {
            // If no new logs but we got logs, replace (user might have changed time window)
            console.log(`Replacing logs (no new unique logs found)`);
            this.logs = logs;
        } else {
            // Keep existing logs if no new logs found
            console.log(`No new logs, keeping existing ${this.logs.length} logs`);
        }
        
        console.log(`LogTreeDataProvider now has ${this.logs.length} logs`);
        if (this.logs.length > 0) {
            console.log(`First log stored: ${this.logs[0].id}`);
        }
        // Fire the event to refresh the tree view
        this._onDidChangeTreeData.fire();
        console.log(`Tree data change event fired`);
    }

    getTreeItem(element: LogTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: LogTreeItem): Thenable<LogTreeItem[]> {
        if (!element) {
            // Root level: return all log entries
            console.log(`getChildren called for root, returning ${this.logs.length} logs`);
            const items = this.logs.map(log => {
                console.log(`Creating LogTreeItem for log: ${log.id}`);
                return new LogTreeItem(log, vscode.TreeItemCollapsibleState.None);
            });
            return Promise.resolve(items);
        }
        return Promise.resolve([]);
    }
}

export class LogTreeItem extends vscode.TreeItem {
    constructor(
        public readonly logEntry: ApexLogEntry,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(
            `${logEntry.operation} - ${formatTime(logEntry.startTime)} (${formatDuration(logEntry.durationMilliseconds)})`,
            collapsibleState
        );

        this.tooltip = `Log ID: ${logEntry.id}\nOperation: ${logEntry.operation}\nStart Time: ${logEntry.startTime}\nDuration: ${logEntry.durationMilliseconds}ms\nLength: ${formatBytes(logEntry.logLength)}\n\nClick to download and create analysis packet`;
        this.description = formatBytes(logEntry.logLength);
        this.contextValue = 'logEntry';
        
        // Make item clickable - clicking will trigger download
        // Pass logId as string instead of the whole object (VS Code serialization issue)
        // Store logId in a way that VS Code can serialize
        const logId = logEntry.id;
        this.command = {
            command: 'debugforce.downloadLog',
            title: 'Download Log & Create Analysis Packet',
            arguments: [logId]
        };
        
        // Also store logId in a property that can be accessed
        (this as any).logId = logId;
        
        // Use a log icon
        this.iconPath = new vscode.ThemeIcon('file-text');
    }
}

function formatTime(isoString: string): string {
    if (!isoString) {
        return 'Unknown';
    }
    try {
        const date = new Date(isoString);
        return date.toLocaleString();
    } catch {
        return isoString;
    }
}

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes}B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)}KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
