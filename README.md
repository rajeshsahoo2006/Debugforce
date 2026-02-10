# Debugforce - Agentforce Edition

A VS Code/Cursor extension for Salesforce debug logging that enables debug logging for the currently authenticated Salesforce CLI user, fetches only that user's Apex logs from the last N minutes, downloads selected logs, and intelligently analyzes them with **Agentforce-powered error detection**.

## 🌟 Features

- **🔍 Smart Error Detection**: Automatically identifies and highlights only files with errors and exceptions
- **⚡ Agentforce Analysis**: Local, fast analysis that focuses on actionable insights
- **🎨 Modern UI**: Glassmorphism-style Control Panel for managing logs
- **⚙️ Auto Setup**: Automatically creates TraceFlags and DebugLevels for the logged-in user
- **📥 Smart Fetch**: Queries Apex logs using Salesforce MCP (with CLI fallback) filtered by the authenticated user
- **📊 Intelligent Reports**: Downloads selected logs and generates focused analysis reports
- **🧹 Auto Cleanup**: Removes trace flags when done debugging
- **🌲 Tree View**: Visual log browser in the Explorer sidebar
- **🚀 Quick Access**: Status bar integration for instant access

## Prerequisites

1. **Salesforce CLI**: Install from [https://developer.salesforce.com/tools/salesforcecli](https://developer.salesforce.com/tools/salesforcecli)
2. **Authenticated Org**: Run `sf org login web` or `sf org login sfdx-url` to authenticate
3. **Salesforce MCP** (Optional but recommended): Configure Salesforce MCP server in Cursor for better performance

## Installation

1. Clone or download this extension
2. Open in VS Code/Cursor
3. Run `npm install`
4. Press `F5` to launch extension development host, or package with `vsce package` and install the `.vsix` file

## ⚙️ Configuration

### Extension Settings

Add these settings to your `settings.json`:

```json
{
  "debugforce.timeWindowMinutes": 30,
  "debugforce.maxLogs": 50,
  "debugforce.traceMinutes": 30,
  "debugforce.outputFolder": ".debugforce/analysis",
  "debugforce.rawLogsFolder": ".debugforce/logs",
  "debugforce.truncateRawLogBytes": 1500000,
  "debugforce.enableAutoFetch": true
}
```

### Settings Explained

- **timeWindowMinutes**: How far back to look for logs (default: 30)
- **maxLogs**: Maximum number of logs to fetch (default: 50)
- **traceMinutes**: Duration for trace flags (default: 30)
- **outputFolder**: Where to save analysis reports (default: .debugforce/analysis)
- **rawLogsFolder**: Where to save raw log files (default: .debugforce/logs)
- **truncateRawLogBytes**: Max size for raw logs in analysis (~1.5MB)
- **enableAutoFetch**: Auto-fetch logs every 2 minutes after setup (default: true)

## Salesforce MCP Configuration

For optimal performance, configure the Salesforce MCP server in Cursor. Add this to your `mcp.json` (typically located at `~/.cursor/mcp.json` or `~/.config/cursor/mcp.json`):

```json
{
  "mcpServers": {
    "Salesforce DX": {
      "command": "npx",
      "args": [
        "-y",
        "@salesforce/mcp@latest",
        "--orgs",
        "DEFAULT_TARGET_ORG",
        "--toolsets",
        "data,orgs,users,metadata"
      ]
    }
  }
}
```

**Note**: Replace `DEFAULT_TARGET_ORG` with your org alias or username. The extension will fall back to Salesforce CLI if MCP is not available.

## Usage

### Step 1: Setup Debug Logging

1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Run: **Debugforce: Setup Debug Logging (30 min)**
3. This creates a TraceFlag for your user that expires in 30 minutes (configurable)

### Step 2: Generate Activity

Perform actions in your Salesforce org that you want to debug (run flows, execute Apex, etc.)

### Step 3: Fetch Logs

1. Click the **Debugforce** status bar button, or
2. Open Command Palette and run: **Debugforce: Fetch Logs (Last N Minutes)**
3. Logs will appear in the **Debugforce Logs** tree view

### Step 4: Download & Analyze

1. Click on a log entry in the tree view
2. The extension will:
   - Download the log file
   - Generate an analysis packet markdown file
   - Open it in the editor

The analysis packet includes:

- **Header**: Org/user information and context
- **Smart Cursor Prompt**: Instructs AI to focus only on errors
- **Key Extracts**: Prioritized error lines (exceptions, limits, SOQL, DML, flows)
- **Raw Log**: Full log content (truncated if too large)
- **Error Focus**: Automatically filters out clean sections

### Step 5: Agentforce Analysis

1. **Analyze Individual Logs**: Select specific logs and click **"✨ Analyze Selected Logs (Local)"** for targeted analysis
2. **Analyze All**: Click **"🔍 Analyze All Logs"** to scan all downloaded logs at once
3. **Review Results**: The extension analyzes logs locally and displays:
   - **Error Summary**: Count and types of errors found
   - **Exception Details**: Specific error messages and context
   - **Root Cause Analysis**: Technical explanation of what went wrong
   - **Recommended Solutions**: Actionable fixes and documentation links
4. **Focus on Errors**: Clean logs (without errors) are automatically ignored to save time

### Step 6: Cleanup (Optional)

When done debugging, run: **Debugforce: Cleanup Trace Flags** to remove trace flags.

## 🔧 How It Works

### 🔒 Data Security Rule

**Debugforce only fetches logs where `ApexLog.LogUserId = SFCLILoggedInUserId`**

The extension:

1. Gets the logged-in user ID via `sf org display user --json`
2. Uses this ID to filter all SOQL queries
3. Performs defensive checks to discard any mismatched records
4. Never allows user input for LogUserId

### 🏗️ Architecture

- **sfCli.ts**: Wraps Salesforce CLI commands using `spawn` (not `exec`) for safety
- **mcp.ts**: Integrates with Salesforce MCP for SOQL queries (falls back to CLI)
- **userContext.ts**: Manages logged-in user info with caching
- **logQuery.ts**: Builds SOQL queries and filters results
- **logDownload.ts**: Downloads log files via CLI
- **logParser.ts**: Intelligently extracts error lines and key events from logs
- **localAnalyzer.ts**: **NEW!** Agentforce-powered local analysis engine
- **markdown.ts**: Generates smart analysis packets with error-focused prompts
- **treeView.ts**: Displays logs in VS Code tree view
- **traceFlags.ts**: Manages TraceFlag and DebugLevel records
- **webviewPanel.ts**: Modern Control Panel UI

### 🎯 Agentforce Analysis Features

1. **Error Detection**: Scans for exceptions, fatal errors, limit breaches, and flow errors
2. **Smart Filtering**: Automatically ignores clean logs to save analysis time
3. **Context Extraction**: Pulls relevant error context from logs
4. **Root Cause Analysis**: Provides technical explanations for failures
5. **Solution Suggestions**: Recommends specific fixes and documentation links
6. **Local Processing**: Fast, privacy-friendly analysis without external API calls

## Troubleshooting

### "Salesforce CLI (sf) is not installed"

- Install Salesforce CLI from the official website
- Ensure `sf` is in your PATH
- Restart VS Code/Cursor after installation

### "No authenticated Salesforce org found"

- Run `sf org login web` to authenticate
- Verify with `sf org display user --json`
- Ensure you're authenticated to the correct org

### "No logs found"

- Ensure debug logging is set up (run Setup Debug Logging command)
- Check that the time window covers when activity occurred
- Verify you performed actions in Salesforce that generate logs
- Check that TraceFlags haven't expired

### "Insufficient access" errors

- Ensure your user has permissions to:
  - Query `ApexLog` object
  - Create/Delete `TraceFlag` records
  - Create `DebugLevel` records
- Contact your Salesforce admin if needed

### MCP Integration Issues

- If MCP queries fail, the extension automatically falls back to CLI
- Verify your `mcp.json` configuration
- Check that the Salesforce MCP server is running
- Ensure the org alias/username in MCP config matches your authenticated org

### Log Download Fails

- Verify the log ID is valid
- Check that the log file exists and is accessible
- Ensure you have permissions to download logs
- Try fetching logs again to refresh the list

## Development

### Building

```bash
npm install
npm run compile
```

### Packaging

```bash
npm install -g @vscode/vsce
vsce package
```

### Testing

1. Open extension in VS Code
2. Press `F5` to launch extension development host
3. Test commands and UI interactions
4. Check output panel for errors

## License

MIT

## Contributing

Contributions welcome! Please ensure:

- Code follows TypeScript best practices
- Uses `spawn` (not `exec`) for CLI commands
- Handles errors gracefully with user-friendly messages
- Maintains the security rule: only fetch logs for logged-in user
