import * as vscode from 'vscode';
import { LogTreeDataProvider, LogTreeItem } from './treeView';
import { ApexLogEntry } from './logQuery';

interface AnalysisResult {
    logId: string;
    operation: string;
    timestamp: string;
    content: string;
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
                    case 'loginWithGoogle':
                        await vscode.commands.executeCommand('debugforce.loginWithGoogle');
                        break;
                    case 'setupDebugLogging':
                        await vscode.commands.executeCommand('debugforce.setupDebugLogging');
                        this._update();
                        break;
                    case 'fetchLogs':
                        await vscode.commands.executeCommand('debugforce.fetchLogs');
                        setTimeout(() => this._update(), 1000);
                        break;
                    case 'downloadLog':
                        if (message.logId) {
                            const logs = this.logTreeProvider.getLogs();
                            const logEntry = logs.find(log => log.id === message.logId);
                            if (logEntry) {
                                const logItem = new LogTreeItem(logEntry, vscode.TreeItemCollapsibleState.None);
                                await vscode.commands.executeCommand('debugforce.downloadLog', logItem);
                            }
                        }
                        break;
                    case 'analyzeLogs':
                        if (message.logIds && Array.isArray(message.logIds)) {
                            this.analysisResults = []; // Clear previous results
                            const logs = this.logTreeProvider.getLogs();
                            const { generateAnalysisContent, generateAnalysisPacket } = await import('./markdown');
                            const { getCurrentUser } = await import('./userContext');
                            const { downloadLog } = await import('./logDownload');
                            const { downloadRawLog } = await import('./rawLogDownload');
                            const debugforceConfig = vscode.workspace.getConfiguration('debugforce');
                            const timeWindowMinutes = debugforceConfig.get<number>('timeWindowMinutes', 30);
                            const truncateRawLogBytes = debugforceConfig.get<number>('truncateRawLogBytes', 1500000);
                            const outputFolder = debugforceConfig.get<string>('outputFolder', '.debugforce/analysis');
                            
                            const userInfo = await getCurrentUser();
                            
                            for (const logId of message.logIds) {
                                const logEntry = logs.find(log => log.id === logId);
                                if (logEntry) {
                                    try {
                                        const logContent = await downloadLog(logId, userInfo.orgAlias);
                                        try {
                                            await downloadRawLog(logId, userInfo.orgAlias, '.debugforce/logs');
                                        } catch (rawLogError) {
                                            console.error(`Failed to save raw log file: ${rawLogError}`);
                                        }
                                        
                                        const analysisContent = generateAnalysisContent({
                                            userInfo,
                                            logId,
                                            timeWindowMinutes,
                                            logContent,
                                            outputFolder: '',
                                            truncateRawLogBytes
                                        });
                                        
                                        this.analysisResults.push({
                                            logId: logEntry.id,
                                            operation: logEntry.operation,
                                            timestamp: new Date().toISOString(),
                                            content: analysisContent
                                        });
                                        
                                        try {
                                            await generateAnalysisPacket({
                                                userInfo,
                                                logId,
                                                timeWindowMinutes,
                                                logContent,
                                                outputFolder,
                                                truncateRawLogBytes
                                            });
                                        } catch (fileError) {
                                            console.error(`Failed to save analysis file: ${fileError}`);
                                        }
                                    } catch (error) {
                                        const errorMsg = error instanceof Error ? error.message : String(error);
                                        this.analysisResults.push({
                                            logId: logEntry.id,
                                            operation: logEntry.operation,
                                            timestamp: new Date().toISOString(),
                                            content: `# Error Analyzing Log ${logEntry.id}\n\nError: ${errorMsg}`
                                        });
                                    }
                                }
                            }
                            this._update();
                            vscode.window.showInformationMessage(
                                `Debugforce: Analyzed ${this.analysisResults.length} log(s). Results displayed in control panel.`
                            );
                        }
                        break;
                    case 'analyzeWithGemini':
                        await vscode.commands.executeCommand('debugforce.analyzeWithGemini');
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

    private _update() {
        const logs = this.logTreeProvider.getLogs();
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview, logs, this.analysisResults);
    }

    private _getHtmlForWebview(webview: vscode.Webview, logs: ApexLogEntry[], analysisResults: AnalysisResult[]): string {
        const logsHtml = logs.length > 0
            ? `
                <div class="logs-header">
                    <h2>📋 Available Logs (${logs.length})</h2>
                    <div class="selection-info">
                        <span id="selectedCount">0</span> selected
                        <button class="btn-text" onclick="toggleSelectAll()">Select All</button>
                        <button class="btn-text" onclick="clearSelection()">Clear</button>
                    </div>
                </div>
                <div class="logs-list">
                    ${logs.map((log, index) => `
                        <div class="log-entry" data-log-id="${log.id}">
                            <label class="log-checkbox-label">
                                <input type="checkbox" class="log-checkbox" value="${log.id}" onchange="updateSelection()">
                                <div class="log-content">
                                    <div class="log-row">
                                        <span class="log-index">#${index + 1}</span>
                                        <strong class="log-op">${log.operation}</strong>
                                        <span class="log-size">${this._formatBytes(log.logLength)}</span>
                                    </div>
                                    <div class="log-meta">
                                        <span>🕒 ${this._formatTime(log.startTime)}</span>
                                        <span>⏱️ ${this._formatDuration(log.durationMilliseconds)}</span>
                                        <span class="log-id-mono">${log.id}</span>
                                    </div>
                                </div>
                            </label>
                        </div>
                    `).join('')}
                </div>
                <div class="actions-bar">
                    <button class="btn-primary" id="btnAnalyze" onclick="analyzeSelectedLogs()" disabled>
                        ✨ Analyze Selected Logs
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

                    .log-entry {
                        background: rgba(0, 0, 0, 0.2);
                        border: 1px solid transparent;
                        border-radius: 8px;
                        transition: all 0.2s;
                    }

                    .log-entry:hover {
                        background: rgba(255, 255, 255, 0.05);
                    }

                    .log-entry.selected {
                        border-color: var(--primary-color);
                        background: rgba(76, 175, 80, 0.1);
                    }

                    .log-checkbox-label {
                        display: flex;
                        padding: 12px;
                        cursor: pointer;
                        width: 100%;
                    }

                    .log-content {
                        flex: 1;
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                    }

                    .log-row {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }

                    .log-meta {
                        display: flex;
                        gap: 12px;
                        font-size: 0.85rem;
                        color: var(--vscode-descriptionForeground);
                    }
                    
                    .log-id-mono {
                        font-family: monospace;
                        opacity: 0.7;
                    }

                    .log-size {
                        background: rgba(255,255,255,0.1);
                        padding: 2px 6px;
                        border-radius: 4px;
                        font-size: 0.8rem;
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
                    <!-- Auth Card -->
                    <div class="card">
                        <div class="card-header">
                            <h3 class="card-title">🔐 Authentication</h3>
                            <span class="status-pill status-success" style="display:none;" id="authStatus">Connected</span>
                        </div>
                        <p style="margin-bottom: 16px; font-size: 0.9rem; opacity: 0.8;">
                            Connect with Google to enable advanced log analysis with Gemini.
                        </p>
                        <button class="btn-google" onclick="loginWithGoogle()">
                            <svg width="18" height="18" viewBox="0 0 18 18">
                                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.715H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
                                <path fill="#FBBC05" d="M3.964 10.71a5.41 5.41 0 0 1 0-3.42V4.958H.957a9.006 9.006 0 0 0 0 6.64l3.007-2.332z"/>
                                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                            </svg>
                            Connect with Google
                        </button>
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
                    let selectedLogs = new Set();
                    
                    function loginWithGoogle() {
                        vscode.postMessage({ command: 'loginWithGoogle' });
                    }

                    function setupDebugLogging() {
                        vscode.postMessage({ command: 'setupDebugLogging' });
                    }
                    
                    function fetchLogs() {
                        vscode.postMessage({ command: 'fetchLogs' });
                    }
                    
                    function updateSelection() {
                        const checkboxes = document.querySelectorAll('.log-checkbox:checked');
                        selectedLogs = new Set(Array.from(checkboxes).map(cb => cb.value));
                        document.getElementById('selectedCount').textContent = selectedLogs.size;
                        
                        const btnAnalyze = document.getElementById('btnAnalyze');
                        if (btnAnalyze) {
                            btnAnalyze.disabled = selectedLogs.size === 0;
                            btnAnalyze.innerHTML = selectedLogs.size > 0 
                                ? '✨ Analyze ' + selectedLogs.size + ' Log(s)' 
                                : '✨ Analyze Selected Logs';
                        }
                        
                        document.querySelectorAll('.log-entry').forEach(entry => {
                            const logId = entry.dataset.logId;
                            if (selectedLogs.has(logId)) {
                                entry.classList.add('selected');
                            } else {
                                entry.classList.remove('selected');
                            }
                        });
                    }
                    
                    function toggleSelectAll() {
                        const checkboxes = document.querySelectorAll('.log-checkbox');
                        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
                        checkboxes.forEach(cb => cb.checked = !allChecked);
                        updateSelection();
                    }
                    
                    function clearSelection() {
                        document.querySelectorAll('.log-checkbox').forEach(cb => cb.checked = false);
                        updateSelection();
                    }
                    
                    function analyzeSelectedLogs() {
                        if (selectedLogs.size === 0) return;
                        
                        const btn = document.getElementById('btnAnalyze');
                        const originalText = btn.innerHTML;
                        btn.disabled = true;
                        btn.innerHTML = '⏳ Analyzing...';
                        
                        const logIds = Array.from(selectedLogs);
                        vscode.postMessage({ command: 'analyzeLogs', logIds: logIds });
                        
                        // We rely on the extension to reload the view with results
                    }
                    
                    function analyzeWithGemini() {
                        vscode.postMessage({ command: 'analyzeWithGemini' });
                    }
                </script>
            </body>
            </html>`;
    }

    private _formatTime(isoString: string): string {
        if (!isoString) return 'Unknown';
        try {
            const date = new Date(isoString);
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch {
            return isoString;
        }
    }

    private _formatDuration(ms: number): string {
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(2)}s`;
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
