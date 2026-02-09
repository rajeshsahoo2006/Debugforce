import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);

/**
 * Analyze all logs using Gemini API
 */
export async function analyzeLogsWithGemini(
    logsFolder: string,
    apiKey: string
): Promise<string> {
    // Read all log files
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
        throw new Error(`Logs folder not found: ${logsDir}`);
    }

    if (logFiles.length === 0) {
        return 'No log files found in .debugforce/logs folder.';
    }

    // Read all log files
    const logContents: Array<{ filename: string; content: string }> = [];
    for (const file of logFiles) {
        try {
            const filePath = path.join(logsDir, file);
            const content = await readFile(filePath, 'utf-8');
            logContents.push({ filename: file, content });
        } catch (error) {
            console.error(`Failed to read ${file}: ${error}`);
        }
    }

    if (logContents.length === 0) {
        return 'No log files could be read.';
    }

    // Prepare prompt for Gemini
    const prompt = `Analyze all downloaded Salesforce debug logs and provide a summarized report. Group the findings by file, listing the latest logs first and the oldest logs last. Please follow this format strictly and ignore any files that do not contain errors.

Format for each log with errors:

\`\`\`
Log File Name: [File Name]

Exceptions & Error Lines: [Extract specific FATAL_ERROR, EXCEPTION_THROWN, or limit breach lines], salesforce Possible error.. 

Root Cause Analysis: [Explain the likely technical reason for this failure based on the log context]

Web-Based Solutions: [Search for or suggest known fixes, specific Salesforce documentation, or StackExchange resolutions]
\`\`\`

Note: Do not provide a line-by-line breakdown. Summarize the findings into a clean list.

If no errors found in any logs, state: "✅ No errors detected in any of the analyzed logs."

---

Log Files to Analyze:

${logContents.map((log, index) => `
=== Log File ${index + 1}: ${log.filename} ===

${log.content.substring(0, 50000)} ${log.content.length > 50000 ? '\n... (truncated)' : ''}
`).join('\n\n')}`;

    // Call Gemini API
    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]
                })
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as {
            candidates?: Array<{
                content?: {
                    parts?: Array<{
                        text?: string;
                    }>;
                };
            }>;
        };
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
            return data.candidates[0].content.parts[0].text || 'No text returned from Gemini API';
        } else {
            throw new Error('Unexpected response format from Gemini API');
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to call Gemini API: ${message}`);
    }
}
