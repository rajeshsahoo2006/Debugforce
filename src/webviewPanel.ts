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
        // This happens when the user closes the panel or when the panel is closed programmatically
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
                        // Wait a bit for logs to be fetched, then update
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
                                        // Download log content once
                                        const logContent = await downloadLog(logId, userInfo.orgAlias);
                                        
                                        // Download raw log file with original name
                                        try {
                                            await downloadRawLog(logId, userInfo.orgAlias, '.debugforce/logs');
                                        } catch (rawLogError) {
                                            console.error(`Failed to save raw log file: ${rawLogError}`);
                                        }
                                        
                                        // Generate analysis content for UI
                                        const analysisContent = generateAnalysisContent({
                                            userInfo,
                                            logId,
                                            timeWindowMinutes,
                                            logContent,
                                            outputFolder: '', // Not needed for content generation
                                            truncateRawLogBytes
                                        });
                                        
                                        // Store analysis result
                                        this.analysisResults.push({
                                            logId: logEntry.id,
                                            operation: logEntry.operation,
                                            timestamp: new Date().toISOString(),
                                            content: analysisContent
                                        });
                                        
                                        // Also save analysis file for reference (using same logContent)
                                        try {
                                            await generateAnalysisPacket({
                                                userInfo,
                                                logId,
                                                timeWindowMinutes,
                                                logContent, // Reuse downloaded content
                                                outputFolder,
                                                truncateRawLogBytes
                                            });
                                        } catch (fileError) {
                                            // File save failed, but we have the content in the UI
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
                            
                            // Update the webview to show results
                            this._update();
                            
                            vscode.window.showInformationMessage(
                                `Debugforce: Analyzed ${this.analysisResults.length} log(s). Results displayed in control panel.`
                            );
                        }
                        break;
                    case 'testQuery':
                        await vscode.commands.executeCommand('debugforce.testQuery');
                        break;
                    case 'runDiagnostics':
                        await vscode.commands.executeCommand('debugforce.runDiagnostics');
                        break;
                    case 'cleanupTraceFlags':
                        await vscode.commands.executeCommand('debugforce.cleanupTraceFlags');
                        this._update();
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

        // If we already have a panel, show it.
        if (DebugforceWebviewPanel.currentPanel) {
            DebugforceWebviewPanel.currentPanel._panel.reveal(column);
            DebugforceWebviewPanel.currentPanel._update();
            return;
        }

        // Otherwise, create a new panel.
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

        // Clean up our resources
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
                        <span id="selectedCount">0</span> log(s) selected
                        <button class="btn-select-all" onclick="toggleSelectAll()">Select All</button>
                        <button class="btn-clear-selection" onclick="clearSelection()">Clear</button>
                    </div>
                </div>
                <div class="logs-list">
                    ${logs.map((log, index) => `
                        <div class="log-entry" data-log-id="${log.id}">
                            <label class="log-checkbox-label">
                                <input type="checkbox" class="log-checkbox" value="${log.id}" onchange="updateSelection()">
                                <div class="log-content">
                                    <div class="log-header">
                                        <strong>${index + 1}. ${log.operation}</strong>
                                        <span class="log-size-badge">${this._formatBytes(log.logLength)}</span>
                                    </div>
                                    <div class="log-details">
                                        <div class="log-detail-item">
                                            <span class="label">Time:</span>
                                            <span class="value">${this._formatTime(log.startTime)}</span>
                                        </div>
                                        <div class="log-detail-item">
                                            <span class="label">Duration:</span>
                                            <span class="value">${this._formatDuration(log.durationMilliseconds)}</span>
                                        </div>
                                        <div class="log-detail-item">
                                            <span class="label">ID:</span>
                                            <span class="value log-id">${log.id}</span>
                                        </div>
                                    </div>
                                </div>
                            </label>
                        </div>
                    `).join('')}
                </div>
                <div class="analyze-section">
                    <button class="btn-analyze" id="btnAnalyze" onclick="analyzeSelectedLogs()" disabled>
                        📊 Analyze Selected Logs
                    </button>
                </div>
            `
            : '<div class="no-logs"><p>No logs found yet.</p><p>Complete Step 1 and Step 2 to see logs here.</p></div>';

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Debugforce - Step by Step Guide</title>
                <style>
                    * {
                        box-sizing: border-box;
                    }
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        margin: 0;
                    }
                    .header {
                        margin-bottom: 30px;
                        padding-bottom: 15px;
                        border-bottom: 2px solid var(--vscode-panel-border);
                    }
                    .header h1 {
                        margin: 0 0 5px 0;
                        font-size: 28px;
                        color: var(--vscode-textLink-foreground);
                    }
                    .header p {
                        margin: 0;
                        color: var(--vscode-descriptionForeground);
                    }
                    .steps-container {
                        display: flex;
                        flex-direction: column;
                        gap: 25px;
                    }
                    .step {
                        border: 2px solid var(--vscode-panel-border);
                        border-radius: 8px;
                        padding: 20px;
                        background-color: var(--vscode-editor-background);
                        transition: border-color 0.3s;
                    }
                    .step.active {
                        border-color: var(--vscode-textLink-foreground);
                        box-shadow: 0 0 10px rgba(0, 123, 255, 0.2);
                    }
                    .step.completed {
                        border-color: #4caf50;
                    }
                    .step-header {
                        display: flex;
                        align-items: center;
                        gap: 15px;
                        margin-bottom: 15px;
                    }
                    .step-number {
                        width: 40px;
                        height: 40px;
                        border-radius: 50%;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-weight: bold;
                        font-size: 18px;
                        flex-shrink: 0;
                    }
                    .step.completed .step-number {
                        background-color: #4caf50;
                    }
                    .step-title {
                        font-size: 20px;
                        font-weight: bold;
                        margin: 0;
                    }
                    .step-description {
                        margin: 10px 0 15px 0;
                        color: var(--vscode-descriptionForeground);
                        line-height: 1.5;
                    }
                    button {
                        padding: 12px 24px;
                        font-size: 14px;
                        cursor: pointer;
                        border: none;
                        border-radius: 4px;
                        font-weight: 500;
                        transition: all 0.2s;
                    }
                    button:hover:not(:disabled) {
                        opacity: 0.9;
                        transform: translateY(-1px);
                    }
                    button:active:not(:disabled) {
                        transform: translateY(0);
                    }
                    button:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }
                    .btn-primary {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        font-size: 16px;
                        padding: 14px 28px;
                    }
                    .btn-secondary {
                        background-color: var(--vscode-button-secondaryBackground);
                        color: var(--vscode-button-secondaryForeground);
                    }
                    .status-message {
                        margin-top: 15px;
                        padding: 12px;
                        border-radius: 4px;
                        font-size: 13px;
                        display: none;
                    }
                    .status-message.success {
                        background-color: rgba(76, 175, 80, 0.2);
                        border-left: 3px solid #4caf50;
                        display: block;
                    }
                    .status-message.error {
                        background-color: rgba(244, 67, 54, 0.2);
                        border-left: 3px solid #f44336;
                        display: block;
                    }
                    .status-message.info {
                        background-color: var(--vscode-textBlockQuote-background);
                        border-left: 3px solid var(--vscode-textBlockQuote-border);
                        display: block;
                    }
                    .logs-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 15px;
                        flex-wrap: wrap;
                        gap: 10px;
                    }
                    .logs-header h2 {
                        margin: 0;
                        font-size: 18px;
                    }
                    .selection-info {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        font-size: 14px;
                    }
                    .btn-select-all, .btn-clear-selection {
                        padding: 6px 12px;
                        font-size: 12px;
                    }
                    .logs-list {
                        max-height: 400px;
                        overflow-y: auto;
                        margin-bottom: 20px;
                    }
                    .log-entry {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 6px;
                        padding: 0;
                        margin-bottom: 10px;
                        background-color: var(--vscode-editor-background);
                        transition: all 0.2s;
                    }
                    .log-entry:hover {
                        border-color: var(--vscode-textLink-foreground);
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                    }
                    .log-entry.selected {
                        border-color: var(--vscode-textLink-foreground);
                        background-color: rgba(0, 123, 255, 0.1);
                    }
                    .log-checkbox-label {
                        display: flex;
                        align-items: flex-start;
                        padding: 15px;
                        cursor: pointer;
                        margin: 0;
                    }
                    .log-checkbox {
                        margin-right: 12px;
                        margin-top: 4px;
                        width: 18px;
                        height: 18px;
                        cursor: pointer;
                        flex-shrink: 0;
                    }
                    .log-content {
                        flex: 1;
                    }
                    .log-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 10px;
                    }
                    .log-header strong {
                        font-size: 16px;
                    }
                    .log-size-badge {
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 4px 10px;
                        border-radius: 12px;
                        font-size: 12px;
                        font-weight: bold;
                    }
                    .log-details {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 10px;
                        font-size: 13px;
                    }
                    .log-detail-item {
                        display: flex;
                        gap: 8px;
                    }
                    .log-detail-item .label {
                        color: var(--vscode-descriptionForeground);
                        font-weight: 500;
                    }
                    .log-detail-item .value {
                        color: var(--vscode-foreground);
                    }
                    .log-id {
                        font-family: monospace;
                        font-size: 11px;
                    }
                    .analyze-section {
                        margin-top: 20px;
                        padding-top: 20px;
                        border-top: 2px solid var(--vscode-panel-border);
                        text-align: center;
                    }
                    .btn-analyze {
                        background-color: #4caf50;
                        color: white;
                        font-size: 16px;
                        padding: 14px 32px;
                    }
                    .btn-analyze:not(:disabled):hover {
                        background-color: #45a049;
                    }
                    .no-logs {
                        padding: 40px 20px;
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                    }
                    .no-logs p {
                        margin: 10px 0;
                    }
                    .analysis-results {
                        margin-top: 20px;
                    }
                    .analysis-result {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 6px;
                        padding: 20px;
                        margin-bottom: 20px;
                        background-color: var(--vscode-editor-background);
                    }
                    .analysis-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 15px;
                        padding-bottom: 10px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .analysis-header h4 {
                        margin: 0;
                        font-size: 18px;
                    }
                    .analysis-time {
                        color: var(--vscode-descriptionForeground);
                        font-size: 12px;
                    }
                    .analysis-content {
                        max-height: 600px;
                        overflow-y: auto;
                        font-size: 13px;
                        line-height: 1.6;
                    }
                    .analysis-content h1 {
                        font-size: 24px;
                        margin-top: 0;
                        margin-bottom: 15px;
                        border-bottom: 2px solid var(--vscode-panel-border);
                        padding-bottom: 10px;
                    }
                    .analysis-content h2 {
                        font-size: 20px;
                        margin-top: 25px;
                        margin-bottom: 15px;
                        color: var(--vscode-textLink-foreground);
                    }
                    .analysis-content h3 {
                        font-size: 16px;
                        margin-top: 20px;
                        margin-bottom: 10px;
                    }
                    .analysis-content code {
                        background-color: var(--vscode-textCodeBlock-background);
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-family: var(--vscode-editor-font-family);
                        font-size: 12px;
                    }
                    .analysis-content pre {
                        background-color: var(--vscode-textCodeBlock-background);
                        padding: 15px;
                        border-radius: 4px;
                        overflow-x: auto;
                        border: 1px solid var(--vscode-panel-border);
                    }
                    .analysis-content pre code {
                        background: none;
                        padding: 0;
                    }
                    .analysis-content ul, .analysis-content ol {
                        margin: 10px 0;
                        padding-left: 25px;
                    }
                    .analysis-content li {
                        margin: 5px 0;
                    }
                    .analysis-content p {
                        margin: 10px 0;
                    }
                    .analysis-content strong {
                        font-weight: 600;
                    }
                    .analysis-content blockquote {
                        border-left: 3px solid var(--vscode-textBlockQuote-border);
                        padding-left: 15px;
                        margin: 15px 0;
                        color: var(--vscode-descriptionForeground);
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>🔍 Debugforce - Step by Step Guide</h1>
                    <p>Follow these steps to set up debug logging and analyze your Salesforce Apex logs</p>
                </div>

                <div class="steps-container">
                    <!-- Step 1: Setup Debug Logging -->
                    <div class="step" id="step1">
                        <div class="step-header">
                            <div class="step-number">1</div>
                            <h3 class="step-title">Set Up Debug Logging</h3>
                        </div>
                        <p class="step-description">
                            Create a TraceFlag and DebugLevel to enable debug logging for your user. 
                            This will capture detailed execution logs for the next 30 minutes.
                        </p>
                        <button class="btn-primary" onclick="setupDebugLogging()">
                            ⚙️ Setup Debug Logging (30 min)
                        </button>
                        <div class="status-message" id="step1-status"></div>
                    </div>

                    <!-- Step 2: Fetch Logs -->
                    <div class="step" id="step2">
                        <div class="step-header">
                            <div class="step-number">2</div>
                            <h3 class="step-title">Download and Show All Debug Logs</h3>
                        </div>
                        <p class="step-description">
                            Fetch all available Apex logs from Salesforce. Logs will be displayed below with their sizes.
                            Make sure you've performed some actions in Salesforce after Step 1 to generate logs.
                        </p>
                        <button class="btn-primary" onclick="fetchLogs()">
                            📥 Fetch Logs
                        </button>
                        <div style="margin-top: 10px;">
                            <button class="btn-secondary" onclick="analyzeWithGemini()">
                                🤖 Analyze All Logs with Gemini
                            </button>
                        </div>
                        <div class="status-message" id="step2-status"></div>
                    </div>

                    <!-- Step 3: Select and Analyze Logs -->
                    <div class="step" id="step3">
                        <div class="step-header">
                            <div class="step-number">3</div>
                            <h3 class="step-title">Select Logs and Analyze</h3>
                        </div>
                        <p class="step-description">
                            Select one or more logs from the list below, then click "Analyze Selected Logs" to generate 
                            analysis packets. Each selected log will be downloaded and analyzed.
                        </p>
                        ${logsHtml}
                    </div>

                    <!-- Step 4: Analysis Results -->
                    ${analysisResults.length > 0 ? `
                    <div class="step" id="step4">
                        <div class="step-header">
                            <div class="step-number">4</div>
                            <h3 class="step-title">Analysis Results</h3>
                        </div>
                        <p class="step-description">
                            Analysis results for ${analysisResults.length} log(s). Review the analysis below.
                        </p>
                        <div class="analysis-results">
                            ${analysisResults.map((result, index) => `
                                <div class="analysis-result">
                                    <div class="analysis-header">
                                        <h4>Log ${index + 1}: ${result.operation} (${result.logId})</h4>
                                        <span class="analysis-time">${this._formatTime(result.timestamp)}</span>
                                    </div>
                                    <div class="analysis-content">
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
                    
                    function setupDebugLogging() {
                        const statusEl = document.getElementById('step1-status');
                        statusEl.className = 'status-message info';
                        statusEl.textContent = 'Setting up debug logging...';
                        vscode.postMessage({ command: 'setupDebugLogging' });
                        setTimeout(() => {
                            statusEl.className = 'status-message success';
                            statusEl.textContent = '✓ Debug logging setup completed! You can now perform actions in Salesforce.';
                            document.getElementById('step1').classList.add('completed');
                            document.getElementById('step2').classList.add('active');
                        }, 2000);
                    }
                    
                    function fetchLogs() {
                        const statusEl = document.getElementById('step2-status');
                        statusEl.className = 'status-message info';
                        statusEl.textContent = 'Fetching logs from Salesforce...';
                        vscode.postMessage({ command: 'fetchLogs' });
                        setTimeout(() => {
                            statusEl.className = 'status-message success';
                            statusEl.textContent = '✓ Logs fetched successfully! Select logs below to analyze.';
                            document.getElementById('step2').classList.add('completed');
                            document.getElementById('step3').classList.add('active');
                            window.location.reload();
                        }, 2000);
                    }
                    
                    function updateSelection() {
                        const checkboxes = document.querySelectorAll('.log-checkbox:checked');
                        selectedLogs = new Set(Array.from(checkboxes).map(cb => cb.value));
                        document.getElementById('selectedCount').textContent = selectedLogs.size;
                        
                        const btnAnalyze = document.getElementById('btnAnalyze');
                        btnAnalyze.disabled = selectedLogs.size === 0;
                        
                        // Update visual selection
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
                    
                    function analyzeWithGemini() {
                        vscode.postMessage({ command: 'analyzeWithGemini' });
                    }
                    
                    function analyzeSelectedLogs() {
                        if (selectedLogs.size === 0) {
                            return;
                        }
                        
                        const logIds = Array.from(selectedLogs);
                        vscode.postMessage({ command: 'analyzeLogs', logIds: logIds });
                        
                        const statusEl = document.getElementById('step3').querySelector('.status-message');
                        if (!statusEl) {
                            const step3 = document.getElementById('step3');
                            const statusDiv = document.createElement('div');
                            statusDiv.className = 'status-message info';
                            statusDiv.id = 'step3-status';
                            statusDiv.textContent = \`Analyzing \${logIds.length} log(s)...\`;
                            step3.appendChild(statusDiv);
                        } else {
                            statusEl.className = 'status-message info';
                            statusEl.textContent = \`Analyzing \${logIds.length} log(s)...\`;
                        }
                        
                        // Reload after analysis completes to show results
                        setTimeout(() => {
                            window.location.reload();
                        }, 3000);
                    }
                    
                    // Initialize
                    updateSelection();
                </script>
            </body>
            </html>`;
    }

    private _formatTime(isoString: string): string {
        if (!isoString) return 'Unknown';
        try {
            const date = new Date(isoString);
            return date.toLocaleString();
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
        let html = markdown;
        
        // Escape HTML
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // Headers
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        
        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // Code blocks
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Lists
        html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
        
        // Blockquotes
        html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');
        
        // Paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';
        
        // Clean up nested lists
        html = html.replace(/<\/ul>\s*<ul>/g, '');
        
        // Horizontal rules
        html = html.replace(/^---$/gim, '<hr>');
        
        return html;
    }
}
