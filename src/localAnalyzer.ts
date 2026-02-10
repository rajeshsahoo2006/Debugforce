import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);

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

/**
 * Analyze a single log file for errors and exceptions
 */
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
        summary: ''
    };

    // Scan for errors
    for (const line of lines) {
        // Check for exceptions
        if (line.includes('EXCEPTION_THROWN') || line.includes('UNHANDLED_EXCEPTION')) {
            analysis.exceptions.push(line.trim());
            analysis.hasErrors = true;
        }

        // Check for fatal errors
        if (line.includes('FATAL_ERROR') || line.includes('System.')) {
            analysis.fatalErrors.push(line.trim());
            analysis.hasErrors = true;
        }

        // Check for limit usage issues (CPU, Heap, SOQL, DML)
        if (line.includes('LIMIT_USAGE') || line.includes('MAXIMUM_LIMIT_USAGE')) {
            const limitMatch = line.match(/LIMIT_USAGE.*?\|(.+)/);
            if (limitMatch) {
                const limitInfo = limitMatch[1].trim();
                // Check if limits are approaching maximum (above 80%)
                const limitValues = limitInfo.match(/(\d+)\s*out of\s*(\d+)/);
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

        // Check for flow errors
        if (line.includes('FLOW_ELEMENT_ERROR') || line.includes('FLOW_ELEMENT_FAULT') || 
            line.includes('FLOW_CREATE_INTERVIEW_ERROR')) {
            analysis.flowErrors.push(line.trim());
            analysis.hasErrors = true;
        }

        // Check for validation errors
        if (line.includes('VALIDATION_FAIL') || line.includes('VALIDATION_ERROR')) {
            analysis.validationErrors.push(line.trim());
            analysis.hasErrors = true;
        }
    }

    // Generate summary
    if (analysis.hasErrors) {
        const parts = [];
        if (analysis.exceptions.length > 0) {
            parts.push(`${analysis.exceptions.length} exception(s)`);
        }
        if (analysis.fatalErrors.length > 0) {
            parts.push(`${analysis.fatalErrors.length} fatal error(s)`);
        }
        if (analysis.limitIssues.length > 0) {
            parts.push(`${analysis.limitIssues.length} limit warning(s)`);
        }
        if (analysis.flowErrors.length > 0) {
            parts.push(`${analysis.flowErrors.length} flow error(s)`);
        }
        if (analysis.validationErrors.length > 0) {
            parts.push(`${analysis.validationErrors.length} validation error(s)`);
        }
        analysis.summary = parts.join(', ');
    }

    return analysis;
}

/**
 * Analyze all logs in the specified folder
 * Only returns logs that contain errors or exceptions
 */
export async function analyzeLogsLocally(logsFolder: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder open');
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const logsDir = path.join(workspaceRoot, logsFolder);

    // Check if directory exists
    let logFiles: string[] = [];
    try {
        const files = await readdir(logsDir);
        logFiles = files.filter(f => f.endsWith('.log')).sort().reverse(); // Newest first
    } catch (error) {
        return '❌ Logs folder not found. Please fetch logs first.';
    }

    if (logFiles.length === 0) {
        return '📂 No log files found in .debugforce/logs folder.';
    }

    // Read and analyze all log files
    const analyses: LogAnalysis[] = [];
    for (const file of logFiles) {
        try {
            const filePath = path.join(logsDir, file);
            const content = await readFile(filePath, 'utf-8');
            const analysis = analyzeLogContent(file, content);
            
            // Only include logs with errors
            if (analysis.hasErrors) {
                analyses.push(analysis);
            }
        } catch (error) {
            console.error(`Failed to read ${file}: ${error}`);
        }
    }

    // Generate report
    if (analyses.length === 0) {
        return `✅ **No errors detected in any of the ${logFiles.length} analyzed log(s).**\n\nAll logs appear to be clean. Great job!`;
    }

    // Build error report
    let report = `# 🔍 Agentforce Log Analysis Report\n\n`;
    report += `**Total Logs Analyzed**: ${logFiles.length}\n`;
    report += `**Logs with Errors**: ${analyses.length}\n`;
    report += `**Clean Logs**: ${logFiles.length - analyses.length}\n\n`;
    report += `---\n\n`;

    // List each log with errors
    for (let i = 0; i < analyses.length; i++) {
        const analysis = analyses[i];
        report += `## Log ${i + 1}: ${analysis.filename}\n\n`;
        report += `**Summary**: ${analysis.summary}\n\n`;

        if (analysis.exceptions.length > 0) {
            report += `### 🚨 Exceptions\n\n`;
            report += '```\n';
            report += analysis.exceptions.slice(0, 5).join('\n'); // Limit to first 5
            if (analysis.exceptions.length > 5) {
                report += `\n... and ${analysis.exceptions.length - 5} more exception(s)\n`;
            }
            report += '\n```\n\n';
        }

        if (analysis.fatalErrors.length > 0) {
            report += `### ❌ Fatal Errors\n\n`;
            report += '```\n';
            report += analysis.fatalErrors.slice(0, 5).join('\n');
            if (analysis.fatalErrors.length > 5) {
                report += `\n... and ${analysis.fatalErrors.length - 5} more error(s)\n`;
            }
            report += '\n```\n\n';
        }

        if (analysis.limitIssues.length > 0) {
            report += `### ⚠️ Limit Warnings\n\n`;
            report += '```\n';
            report += analysis.limitIssues.slice(0, 3).join('\n');
            if (analysis.limitIssues.length > 3) {
                report += `\n... and ${analysis.limitIssues.length - 3} more limit warning(s)\n`;
            }
            report += '\n```\n\n';
        }

        if (analysis.flowErrors.length > 0) {
            report += `### 🌊 Flow Errors\n\n`;
            report += '```\n';
            report += analysis.flowErrors.slice(0, 3).join('\n');
            if (analysis.flowErrors.length > 3) {
                report += `\n... and ${analysis.flowErrors.length - 3} more flow error(s)\n`;
            }
            report += '\n```\n\n';
        }

        if (analysis.validationErrors.length > 0) {
            report += `### 📋 Validation Errors\n\n`;
            report += '```\n';
            report += analysis.validationErrors.slice(0, 5).join('\n');
            if (analysis.validationErrors.length > 5) {
                report += `\n... and ${analysis.validationErrors.length - 5} more validation error(s)\n`;
            }
            report += '\n```\n\n';
        }

        // Add root cause suggestion
        report += `### 💡 Root Cause Analysis\n\n`;
        if (analysis.exceptions.length > 0) {
            report += `This log contains ${analysis.exceptions.length} exception(s). `;
            report += `Review the exception messages above to identify the root cause. Common causes include:\n`;
            report += `- Null pointer exceptions (accessing null values)\n`;
            report += `- Type conversion errors\n`;
            report += `- Invalid data or failed validations\n`;
            report += `- Permission issues\n\n`;
        }
        if (analysis.limitIssues.length > 0) {
            report += `Governor limits are being approached or exceeded. Consider optimizing:\n`;
            report += `- Query efficiency (reduce SOQL queries in loops)\n`;
            report += `- Bulk operations (process records in batches)\n`;
            report += `- CPU time (optimize complex calculations)\n\n`;
        }
        if (analysis.flowErrors.length > 0) {
            report += `Flow execution errors detected. Check:\n`;
            report += `- Flow element configurations\n`;
            report += `- Variable assignments and null checks\n`;
            report += `- Record lookups and data availability\n\n`;
        }
        if (analysis.validationErrors.length > 0) {
            report += `Validation rule(s) blocked the operation. Check:\n`;
            report += `- The validation rule formula and error message\n`;
            report += `- Required fields or conditions before the action\n`;
            report += `- Case/Object Manager > Validation Rules in Setup\n\n`;
        }

        report += `### 🔗 Recommended Actions\n\n`;
        report += `1. Review the error details in the full log file: \`.debugforce/logs/${analysis.filename}\`\n`;
        report += `2. Search Salesforce documentation and Stack Exchange for similar errors\n`;
        report += `3. Add debug statements or adjust log levels if more context is needed\n`;
        report += `4. Consider using breakpoints or checkpoints for deeper debugging\n\n`;
        report += `---\n\n`;
    }

    return report;
}
