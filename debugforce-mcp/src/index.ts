#!/usr/bin/env node

/**
 * Debugforce MCP Server
 * Exposes analyze_apex_logs tool for Cursor and other MCP clients.
 * Works with logs downloaded by the Debugforce VS Code extension.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

interface LogAnalysis {
  filename: string;
  hasErrors: boolean;
  exceptions: string[];
  fatalErrors: string[];
  limitIssues: string[];
  flowErrors: string[];
  validationErrors: string[];
  summary: string;
}

function analyzeLogContent(filename: string, content: string): LogAnalysis {
  const lines = content.split('\n');
  const analysis: LogAnalysis = {
    filename,
    hasErrors: false,
    exceptions: [],
    fatalErrors: [],
    limitIssues: [],
    flowErrors: [],
    validationErrors: [],
    summary: '',
  };

  for (const line of lines) {
    if (line.includes('EXCEPTION_THROWN') || line.includes('UNHANDLED_EXCEPTION')) {
      analysis.exceptions.push(line.trim());
      analysis.hasErrors = true;
    }
    if (line.includes('FATAL_ERROR') || line.includes('System.')) {
      analysis.fatalErrors.push(line.trim());
      analysis.hasErrors = true;
    }
    if (line.includes('LIMIT_USAGE') || line.includes('MAXIMUM_LIMIT_USAGE')) {
      const limitMatch = line.match(/LIMIT_USAGE.*?\|(.+)/);
      if (limitMatch) {
        const limitValues = limitMatch[1].match(/(\d+)\s*out of\s*(\d+)/);
        if (limitValues) {
          const used = parseInt(limitValues[1]);
          const max = parseInt(limitValues[2]);
          if (used / max > 0.8) {
            analysis.limitIssues.push(line.trim());
            analysis.hasErrors = true;
          }
        }
      }
    }
    if (
      line.includes('FLOW_ELEMENT_ERROR') ||
      line.includes('FLOW_ELEMENT_FAULT') ||
      line.includes('FLOW_CREATE_INTERVIEW_ERROR')
    ) {
      analysis.flowErrors.push(line.trim());
      analysis.hasErrors = true;
    }
    if (line.includes('VALIDATION_FAIL') || line.includes('VALIDATION_ERROR')) {
      analysis.validationErrors.push(line.trim());
      analysis.hasErrors = true;
    }
  }

  if (analysis.hasErrors) {
    const parts: string[] = [];
    if (analysis.exceptions.length > 0) parts.push(`${analysis.exceptions.length} exception(s)`);
    if (analysis.fatalErrors.length > 0) parts.push(`${analysis.fatalErrors.length} fatal error(s)`);
    if (analysis.limitIssues.length > 0) parts.push(`${analysis.limitIssues.length} limit warning(s)`);
    if (analysis.flowErrors.length > 0) parts.push(`${analysis.flowErrors.length} flow error(s)`);
    if (analysis.validationErrors.length > 0)
      parts.push(`${analysis.validationErrors.length} validation error(s)`);
    analysis.summary = parts.join(', ');
  }

  return analysis;
}

async function analyzeLogsInFolder(logsDir: string): Promise<string> {
  let logFiles: string[] = [];
  try {
    const files = await fs.readdir(logsDir);
    logFiles = files.filter((f) => f.endsWith('.log')).sort().reverse();
  } catch {
    return '❌ Logs folder not found. Use the Debugforce extension to fetch logs first.';
  }

  if (logFiles.length === 0) {
    return '📂 No log files found. Use the Debugforce extension to fetch logs.';
  }

  const analyses: LogAnalysis[] = [];
  for (const file of logFiles) {
    try {
      const filePath = path.join(logsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const analysis = analyzeLogContent(file, content);
      if (analysis.hasErrors) {
        analyses.push(analysis);
      }
    } catch (err) {
      console.error(`Failed to read ${file}:`, err);
    }
  }

  if (analyses.length === 0) {
    return `✅ **No errors detected in any of the ${logFiles.length} analyzed log(s).**\n\nAll logs appear to be clean.`;
  }

  let report = `# 🔍 Debugforce Log Analysis Report\n\n`;
  report += `**Total Logs Analyzed**: ${logFiles.length}\n`;
  report += `**Logs with Errors**: ${analyses.length}\n`;
  report += `**Clean Logs**: ${logFiles.length - analyses.length}\n\n---\n\n`;

  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    report += `## Log ${i + 1}: ${a.filename}\n\n**Summary**: ${a.summary}\n\n`;
    if (a.exceptions.length > 0) {
      report += `### 🚨 Exceptions\n\`\`\`\n${a.exceptions.slice(0, 5).join('\n')}\n\`\`\`\n\n`;
    }
    if (a.fatalErrors.length > 0) {
      report += `### ❌ Fatal Errors\n\`\`\`\n${a.fatalErrors.slice(0, 5).join('\n')}\n\`\`\`\n\n`;
    }
    if (a.limitIssues.length > 0) {
      report += `### ⚠️ Limit Warnings\n\`\`\`\n${a.limitIssues.slice(0, 3).join('\n')}\n\`\`\`\n\n`;
    }
    if (a.flowErrors.length > 0) {
      report += `### 🌊 Flow Errors\n\`\`\`\n${a.flowErrors.slice(0, 3).join('\n')}\n\`\`\`\n\n`;
    }
    if (a.validationErrors.length > 0) {
      report += `### 📋 Validation Errors\n\`\`\`\n${a.validationErrors.slice(0, 5).join('\n')}\n\`\`\`\n\n`;
    }
    report += `### 💡 Next Steps\n`;
    report += `- Review the full log: \`.debugforce/logs/${a.filename}\`\n`;
    report += `- Fix root causes in your Apex/Flow/validation code\n`;
    report += `- Re-fetch logs after changes to verify fixes\n\n---\n\n`;
  }

  return report;
}

const InputSchema = z.object({
  workspaceRoot: z
    .string()
    .optional()
    .describe('Absolute path to the workspace root. Defaults to current working directory.'),
  logsFolder: z
    .string()
    .optional()
    .default('.debugforce/logs')
    .describe('Relative path to logs folder within workspace (default: .debugforce/logs)'),
});

async function main() {
  const server = new McpServer({
    name: 'debugforce-mcp',
    version: '0.1.0',
  });

  server.tool(
    'analyze_apex_logs',
    'Analyze Salesforce Apex debug logs for errors, exceptions, and governor limit issues. Requires logs to be fetched first by the Debugforce VS Code extension.',
    InputSchema.shape,
    async (args) => {
      const { workspaceRoot, logsFolder } = args;
      const root = workspaceRoot || process.cwd();
      const folder = logsFolder ?? '.debugforce/logs';
      const logsDir = path.isAbsolute(folder) ? folder : path.join(root, folder);

      const report = await analyzeLogsInFolder(logsDir);
      return {
        content: [{ type: 'text' as const, text: report }],
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('✅ Debugforce MCP Server running');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
