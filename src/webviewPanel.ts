import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LogTreeDataProvider, LogTreeItem } from './treeView';
import { ApexLogEntry } from './logQuery';

interface AnalysisResult {
    logId: string;
    operation: string;
    timestamp: string;
    content: string;
}

interface LogDisplayEntry {
    id: string;
    filename: string;
    sizeBytes: number;
    createdAt: string; // ISO string from Salesforce StartTime
}

export class DebugforceWebviewPanel {
    private static currentPanel: DebugforceWebviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private logTreeProvider: LogTreeDataProvider;
    private analysisResults: AnalysisResult[] = [];

    private constructor(panel: vscode.WebviewPanel, logTreeProvider: LogTreeDataProvider) {
        this._panel = panel;
        this.logTreeProvider = logTreeProvider;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'setupDebugLogging':
                        await vscode.commands.executeCommand('debugforce.setupDebugLogging');
                        this._update();
                        break;
                    case 'fetchLogs':
                        await vscode.commands.executeCommand('debugforce.fetchLogs');
                        setTimeout(() => this._update(), 1000);
                        break;
                    case 'analyzeWithAgentforce':
                        await vscode.commands.executeCommand('debugforce.analyzeWithAgentforce');
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(logTreeProvider: LogTreeDataProvider) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (DebugforceWebviewPanel.currentPanel) {
            DebugforceWebviewPanel.currentPanel._panel.reveal(column);
            DebugforceWebviewPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'debugforcePanel',
            'Debugforce Control Panel',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        DebugforceWebviewPanel.currentPanel = new DebugforceWebviewPanel(panel, logTreeProvider);
    }

    public dispose() {
        DebugforceWebviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _update() {
        const allLogs = this.logTreeProvider.getLogs();
        const logEntries = await this._getLogsFromFolder(allLogs);
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview, logEntries, this.analysisResults);
    }

    /** Returns log entries with file info (name, size, created time) for files in the logs folder */
    private async _getLogsFromFolder(allLogs: ApexLogEntry[]): Promise<LogDisplayEntry[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }
        const config = vscode.workspace.getConfiguration('debugforce');
        const rawLogsFolder = config.get<string>('rawLogsFolder', '.debugforce/logs');
        const logsDir = path.join(workspaceFolders[0].uri.fsPath, rawLogsFolder);
        const logMeta = new Map<string, ApexLogEntry>(allLogs.map(l => [l.id, l]));
        try {
            const files = await fs.promises.readdir(logsDir);
            const logFiles = files.filter((f: string) => f.endsWith('.log')).sort();
            const entries: LogDisplayEntry[] = [];
            for (const file of logFiles) {
                const logId = file.replace(/\.log$/, '');
                const filePath = path.join(logsDir, file);
                const stat = await fs.promises.stat(filePath);
                const meta = logMeta.get(logId);
                entries.push({
                    id: logId,
                    filename: file,
                    sizeBytes: stat.size,
                    createdAt: meta?.startTime || new Date(stat.mtime).toISOString()
                });
            }
            return entries;
        } catch {
            return [];
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, logs: LogDisplayEntry[], analysisResults: AnalysisResult[]): string {
        const logsHtml = logs.length > 0
            ? `
                <div class="logs-header">
                    <h2>📋 Available Logs (${logs.length})</h2>
                </div>
                <div class="logs-list logs-list-simple">
                    ${logs.map((log) => `
                        <div class="log-entry-simple">
                            <span class="log-name">${this._escapeHtml(log.filename)}</span>
                            <span class="log-size">${this._formatBytes(log.sizeBytes)}</span>
                            <span class="log-time">${this._formatLogTime(log.createdAt)}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="actions-bar">
                    <button class="btn-secondary" onclick="analyzeWithAgentforce()">
                        🔍 Analyze All Logs
                    </button>
                </div>
            `
            : '<div class="empty-state"><div class="empty-icon">📂</div><p>No logs found. Run "Fetch Logs" to get started.</p></div>';

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Debugforce</title>
                <style>
                    :root {
                        --primary-color: #4CAF50;
                        --primary-hover: #45a049;
                        --bg-color: var(--vscode-editor-background);
                        --text-color: var(--vscode-foreground);
                        --card-bg: var(--vscode-editor-background); /* Fallback */
                        --card-border: var(--vscode-panel-border);
                        --glass-bg: rgba(255, 255, 255, 0.05);
                        --glass-border: rgba(255, 255, 255, 0.1);
                        --shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                    }
                    
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--text-color);
                        background-color: var(--bg-color);
                        margin: 0;
                        line-height: 1.6;
                    }

                    /* Authenticated State logic could be handled via localized variable or simple toggle if known */
                    
                    .container {
                        max-width: 800px;
                        margin: 0 auto;
                        display: flex;
                        flex-direction: column;
                        gap: 24px;
                    }

                    /* Cards */
                    .card {
                        background: var(--glass-bg);
                        backdrop-filter: blur(10px);
                        border: 1px solid var(--glass-border);
                        border-radius: 12px;
                        padding: 20px;
                        box-shadow: var(--shadow);
                        transition: transform 0.2s, box-shadow 0.2s;
                    }
                    
                    .card:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 8px 12px rgba(0, 0, 0, 0.2);
                        border-color: var(--vscode-textLink-foreground);
                    }

                    .card-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 16px;
                    }

                    .card-title {
                        font-size: 1.1rem;
                        font-weight: 600;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        margin: 0;
                    }

                    /* Buttons */
                    button {
                        cursor: pointer;
                        border: none;
                        border-radius: 6px;
                        font-weight: 500;
                        font-family: inherit;
                        transition: all 0.2s;
                    }

                    .btn-primary {
                        background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
                        color: white;
                        padding: 10px 20px;
                        width: 100%;
                        font-size: 1rem;
                        box-shadow: 0 2px 4px rgba(76, 175, 80, 0.3);
                    }

                    .btn-primary:disabled {
                        opacity: 0.6;
                        cursor: not-allowed;
                        background: #555;
                        box-shadow: none;
                    }

                    .btn-secondary {
                        background-color: rgba(255, 255, 255, 0.1);
                        color: var(--text-color);
                        padding: 8px 16px;
                    }

                    .btn-secondary:hover {
                        background-color: rgba(255, 255, 255, 0.2);
                    }

                    .btn-google {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 10px;
                        background-color: white;
                        color: #333;
                        padding: 10px 20px;
                        width: 100%;
                        font-size: 1rem;
                        font-weight: 500;
                    }
                     .btn-google:hover {
                        background-color: #f1f1f1;
                     }

                    .btn-text {
                        background: none;
                        color: var(--vscode-textLink-foreground);
                        padding: 4px 8px;
                        font-size: 0.9rem;
                    }
                    
                    .btn-text:hover {
                        text-decoration: underline;
                    }

                    /* Logs List */
                    .logs-list {
                        max-height: 400px;
                        overflow-y: auto;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                        padding-right: 4px;
                    }

                    .logs-list-simple {
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }

                    .log-entry-simple {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 10px 12px;
                        background: rgba(0, 0, 0, 0.2);
                        border-radius: 6px;
                        font-size: 0.9rem;
                    }

                    .log-entry-simple .log-name {
                        font-family: monospace;
                        flex: 1;
                        min-width: 0;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }

                    .log-entry-simple .log-size {
                        margin: 0 16px;
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.85rem;
                    }

                    .log-entry-simple .log-time {
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.85rem;
                        white-space: nowrap;
                    }

                    /* Analysis Results */
                    .analysis-result {
                        margin-top: 20px;
                        animation: slideIn 0.3s ease-out;
                    }

                    @keyframes slideIn {
                        from { opacity: 0; transform: translateY(10px); }
                        to { opacity: 1; transform: translateY(0); }
                    }

                    .markdown-body {
                        font-size: 0.95rem;
                        line-height: 1.6;
                    }
                    
                    .markdown-body h1 { font-size: 1.5rem; border-bottom: 1px solid var(--glass-border); padding-bottom: 0.5em; }
                    .markdown-body h2 { font-size: 1.3rem; margin-top: 1.5em; }
                    .markdown-body pre { background: rgba(0,0,0,0.3); padding: 1em; border-radius: 8px; overflow-x: auto; }
                    .markdown-body code { font-family: 'Menlo', 'Monaco', monospace; font-size: 0.9em; }

                    /* Empty State */
                    .empty-state {
                        text-align: center;
                        padding: 40px;
                        color: var(--vscode-descriptionForeground);
                    }
                    .empty-icon {
                        font-size: 3rem;
                        margin-bottom: 16px;
                        opacity: 0.5;
                    }

                    /* Status */
                    .status-pill {
                        padding: 4px 8px;
                        border-radius: 12px;
                        font-size: 0.8rem;
                        font-weight: 500;
                    }
                    .status-success { background: rgba(76, 175, 80, 0.2); color: #4CAF50; }
                    
                    /* Scrollbar */
                    ::-webkit-scrollbar {
                        width: 8px;
                        height: 8px;
                    }
                    ::-webkit-scrollbar-track {
                        background: transparent;
                    }
                    ::-webkit-scrollbar-thumb {
                        background: rgba(255, 255, 255, 0.2);
                        border-radius: 4px;
                    }
                    ::-webkit-scrollbar-thumb:hover {
                        background: rgba(255, 255, 255, 0.3);
                    }

                </style>
            </head>
            <body>
                <div class="container">
                    <!-- Header Card -->
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">⚡ Debugforce - Agentforce Edition</h3>
                            <span class="status-pill status-success">Ready</span>
                        </div>
                        <p style="margin: 0; font-size: 0.95rem; opacity: 0.9;">
                            Intelligent log analysis powered by local error detection. 
                            Automatically identifies and highlights only files with errors and exceptions.
                        </p>
                    </div>

                    <!-- Steps Card -->
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">🚀 Quick Actions</h3>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <button class="btn-secondary" onclick="setupDebugLogging()">
                                ⚙️ Setup Logging (30m)
                            </button>
                            <button class="btn-secondary" onclick="fetchLogs()">
                                📥 Fetch Latest Logs
                            </button>
                        </div>
                    </div>

                    <!-- Logs Card -->
                    <div class="card">
                        ${logsHtml}
                    </div>

                    <!-- Analysis Results -->
                    ${analysisResults.length > 0 ? `
                        <div class="card">
                            <div class="card-header">
                                <h3 class="card-title">✨ Analysis Results</h3>
                            </div>
                            <div class="analysis-results">
                                ${analysisResults.map(result => `
                                    <div class="analysis-result">
                                        <h4>${result.operation} <span style="font-weight:normal; opacity:0.7">(${result.logId})</span></h4>
                                        <div class="markdown-body">
                                            ${this._markdownToHtml(result.content)}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    function setupDebugLogging() {
                        vscode.postMessage({ command: 'setupDebugLogging' });
                    }
                    
                    function fetchLogs() {
                        vscode.postMessage({ command: 'fetchLogs' });
                    }
                    
                    function analyzeWithAgentforce() {
                        vscode.postMessage({ command: 'analyzeWithAgentforce' });
                    }
                </script>
            </body>
            </html>`;
    }

    private _formatLogTime(isoString: string): string {
        if (!isoString) return '—';
        try {
            const date = new Date(isoString);
            return date.toLocaleString([], {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
        } catch {
            return isoString;
        }
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private _formatBytes(bytes: number): string {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }

    private _markdownToHtml(markdown: string): string {
        // Simple markdown to HTML converter
        let html = markdown
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^\`\`\`\s*([\s\S]*?)\s*\`\`\`/gim, '<pre><code>$1</code></pre>')
            .replace(/\*\*(.*)\*\*/gim, '<b>$1</b>')
            .replace(/\n/gim, '<br />');
        return html;
    }
}
