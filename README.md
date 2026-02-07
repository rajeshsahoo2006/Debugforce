# Debugforce

A VS Code/Cursor extension for Salesforce debug logging that enables debug logging for the currently authenticated Salesforce CLI user, fetches only that user's Apex logs from the last N minutes, downloads selected logs, and generates structured "analysis packet" markdown files for Cursor's default AI to analyze.

## Features

- **Setup Debug Logging**: Automatically creates TraceFlags and DebugLevels for the logged-in user
- **Fetch Logs**: Queries Apex logs using Salesforce MCP (with CLI fallback) filtered by the authenticated user
- **Download & Analyze**: Downloads selected logs and generates markdown analysis packets
- **Cleanup**: Removes trace flags when done debugging
- **Tree View**: Visual log browser in the Explorer sidebar
- **Status Bar Integration**: Quick access via status bar button

## Prerequisites

1. **Salesforce CLI**: Install from [https://developer.salesforce.com/tools/salesforcecli](https://developer.salesforce.com/tools/salesforcecli)
2. **Authenticated Org**: Run `sf org login web` or `sf org login sfdx-url` to authenticate
3. **Salesforce MCP** (Optional but recommended): Configure Salesforce MCP server in Cursor for better performance

## Installation

1. Clone or download this extension
2. Open in VS Code/Cursor
3. Run `npm install`
4. Press `F5` to launch extension development host, or package with `vsce package` and install the `.vsix` file

## Configuration

Add these settings to your `settings.json`:

```json
{
  "debugforce.timeWindowMinutes": 5,
  "debugforce.maxLogs": 50,
  "debugforce.traceMinutes": 30,
  "debugforce.outputFolder": ".debugforce/analysis",
  "debugforce.truncateRawLogBytes": 1500000
}
```

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
- Header with org/user information
- Cursor prompt for AI analysis
- Key extracts (exceptions, limits, SOQL, DML, etc.)
- Raw log content (truncated if too large)

### Step 5: Cleanup (Optional)

When done debugging, run: **Debugforce: Cleanup Trace Flags** to remove trace flags.

## How It Works

### Data Security Rule

**Debugforce only fetches logs where `ApexLog.LogUserId = SFCLILoggedInUserId`**

The extension:
1. Gets the logged-in user ID via `sf org display user --json`
2. Uses this ID to filter all SOQL queries
3. Performs defensive checks to discard any mismatched records
4. Never allows user input for LogUserId

### Architecture

- **sfCli.ts**: Wraps Salesforce CLI commands using `spawn` (not `exec`) for safety
- **mcp.ts**: Integrates with Salesforce MCP for SOQL queries (falls back to CLI)
- **userContext.ts**: Manages logged-in user info with caching
- **logQuery.ts**: Builds SOQL queries and filters results
- **logDownload.ts**: Downloads log files via CLI
- **logParser.ts**: Extracts key lines from logs
- **markdown.ts**: Generates analysis packets
- **treeView.ts**: Displays logs in VS Code tree view
- **traceFlags.ts**: Manages TraceFlag and DebugLevel records

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
