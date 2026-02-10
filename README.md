# Debugforce - Agentforce Edition

A VS Code/Cursor extension for Salesforce debug logging. Setup trace flags, fetch Apex logs, download them to `.debugforce/logs`, and analyze with Cursor using an expert Salesforce log analyst prompt.

## Features

- **Setup Debug Logging**: Creates TraceFlags for the authenticated user
- **Fetch Logs**: Deletes existing logs, fetches metadata from Salesforce, downloads raw logs to `.debugforce/logs`
- **Available Logs**: Lists log files with name, size, and creation time
- **Analyze All Logs**: Generates a Cursor-ready prompt to copy into Cursor Chat for comprehensive error analysis

## Prerequisites

1. **Salesforce CLI**: [https://developer.salesforce.com/tools/salesforcecli](https://developer.salesforce.com/tools/salesforcecli)
2. **Authenticated Org**: `sf org login web` or `sf org login sfdx-url`

## Installation

1. Clone and open in VS Code/Cursor
2. Run `npm install`
3. Press `F5` to launch, or `vsce package` to build `.vsix`

## Configuration

```json
{
  "debugforce.timeWindowMinutes": 30,
  "debugforce.maxLogs": 50,
  "debugforce.traceMinutes": 30,
  "debugforce.rawLogsFolder": ".debugforce/logs",
  "debugforce.outputFolder": ".debugforce/analysis",
  "debugforce.enableAutoFetch": true
}
```

## Usage

1. **Setup Logging** – Run **Debugforce: Setup Debug Logging (30 min)**
2. **Generate Activity** – Perform actions in your Salesforce org
3. **Fetch Logs** – Click **Fetch Latest Logs** in the Control Panel
   - Deletes logs in `.debugforce/logs`
   - Downloads fresh logs from Salesforce
   - Shows available logs (name, size, creation time)
4. **Analyze** – Use any of these options:
   - **Analyze All Logs** – Generates a summary report and opens it in the editor
   - **Open Log for AI Analysis** – Right-click a log in the tree → opens the raw log file so you can ask Cursor to "analyze this Salesforce debug log"
   - **Debugforce MCP** – Add the `analyze_apex_logs` tool (see [debugforce-mcp/README.md](debugforce-mcp/README.md)) to Cursor's MCP config for AI-driven analysis

## Using with Salesforce MCP

Debugforce complements the [Salesforce DX MCP](https://github.com/salesforcecli/mcp). Add both to your Cursor MCP config:
- **Salesforce MCP** – SOQL, deploy, org management
- **Debugforce MCP** – Apex log analysis (see `debugforce-mcp/`)

## Data Security

Debugforce only fetches logs where `ApexLog.LogUserId` matches the authenticated Salesforce CLI user.

## Troubleshooting

- **No logs found**: Ensure Setup Debug Logging ran, activity occurred within the time window, and trace flags haven’t expired
- **Log download fails**: Verify org authentication with `sf org display user --json`
- **Insufficient access**: User needs permission to query `ApexLog`, create/delete `TraceFlag`, and create `DebugLevel`

## Development

```bash
npm install
npm run compile
vsce package
```

## License

MIT
