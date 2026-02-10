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

    refresh(logs: ApexLogEntry[], replace?: boolean): void {
        // When replace=true (e.g. from Fetch Logs), always replace with new list
        if (replace && logs) {
            this.logs = logs;
        } else if (logs && logs.length > 0) {
            // Merge new logs with existing; keep unique by ID
            const existingLogIds = new Set(this.logs.map(log => log.id));
            const newLogs = logs.filter(log => !existingLogIds.has(log.id));
            if (newLogs.length > 0) {
                this.logs = [...this.logs, ...newLogs];
            } else {
                this.logs = logs; // Replace when no new unique IDs (same time window)
            }
        } else if (logs) {
            this.logs = logs; // Empty or explicit replace
        }

        // Sort by StartTime descending (newest first)
        if (this.logs.length > 0) {
            this.logs.sort((a, b) => {
                const timeA = new Date(a.startTime).getTime();
                const timeB = new Date(b.startTime).getTime();
                return timeB - timeA;
            });
        }
        this._onDidChangeTreeData.fire();
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
