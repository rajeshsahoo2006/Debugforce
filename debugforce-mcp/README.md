# Debugforce MCP

MCP server that exposes `analyze_apex_logs` for Cursor and other MCP clients. Analyzes Salesforce Apex debug logs for errors, exceptions, and governor limit issues.

## Prerequisites

- Logs must be fetched first using the **Debugforce** VS Code extension (Setup Logging → Fetch Logs)
- Logs are stored in `.debugforce/logs/` by default

## Build

```bash
cd debugforce-mcp
npm install
npm run build
```

## Cursor Configuration

Add to your Cursor MCP settings (`~/.cursor/mcp.json` or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "Debugforce": {
      "command": "node",
      "args": [
        "/path/to/Debugforce/debugforce-mcp/dist/index.js"
      ],
      "env": {}
    }
  }
}
```

**Using from project root** (replace with your actual path):

```json
{
  "mcpServers": {
    "Debugforce": {
      "command": "node",
      "args": [
        "./debugforce-mcp/dist/index.js"
      ],
      "cwd": "/path/to/your/project"
    }
  }
}
```

Or use `npx` if published:

```json
{
  "mcpServers": {
    "Debugforce": {
      "command": "node",
      "args": [
        "../debugforce-mcp/dist/index.js"
      ],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

**With workspace path** – the tool accepts optional `workspaceRoot` and `logsFolder`:

- `workspaceRoot`: Absolute path to project (defaults to `cwd`)
- `logsFolder`: Relative path to logs (default: `.debugforce/logs`)

## Usage

1. Open a project with Debugforce logs in `.debugforce/logs/`
2. Configure the MCP server with `cwd` set to your workspace (or pass `workspaceRoot` when the AI calls the tool)
3. In Cursor Chat, ask: *"Analyze my Salesforce debug logs"* or *"Run analyze_apex_logs on my project"*

The AI will call the tool and return an analysis report.

## Tool: analyze_apex_logs

| Input        | Type   | Required | Description                                           |
|--------------|--------|----------|-------------------------------------------------------|
| workspaceRoot| string | No       | Absolute path to workspace. Defaults to process cwd. |
| logsFolder   | string | No       | Relative path to logs. Default: `.debugforce/logs`    |
