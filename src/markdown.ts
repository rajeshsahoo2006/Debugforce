import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { OrgUserInfo } from './sfCli';
import { extractKeyLines } from './logParser';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

export interface AnalysisPacketOptions {
    userInfo: OrgUserInfo;
    logId: string;
    timeWindowMinutes: number;
    logContent: string;
    outputFolder: string;
    truncateRawLogBytes: number;
}

/**
 * Generate analysis packet markdown content (without writing to file)
 */
export function generateAnalysisContent(options: AnalysisPacketOptions): string {
    const {
        userInfo,
        logId,
        timeWindowMinutes,
        logContent,
        truncateRawLogBytes
    } = options;

    const downloadTimestamp = new Date().toISOString();
    const isTruncated = Buffer.byteLength(logContent, 'utf8') > truncateRawLogBytes;
    const rawLogContent = isTruncated
        ? logContent.substring(0, truncateRawLogBytes)
        : logContent;

    const keyExtracts = extractKeyLines(logContent, 300);

    const markdown = `# Debugforce Analysis Packet

## Header

- **Org Alias**: ${userInfo.orgAlias || 'N/A'}
- **Username**: ${userInfo.username}
- **SFCLILoggedInUserId**: ${userInfo.userId}
- **Time Window Minutes**: ${timeWindowMinutes}
- **Log Id**: ${logId}
- **Download Timestamp (UTC)**: ${downloadTimestamp}
- **Raw Log File**: .debugforce/logs/${logId}.log

---

## Cursor Prompt

Analyze all downloaded Salesforce debug logs in \`.debugforce/logs\` folder and provide a summarized report. Group the findings by file, listing the latest logs first and the oldest logs last. Please follow this format strictly and ignore any files that do not contain errors.

**Format for each log with errors:**

\`\`\`
Log File Name: [File Name]

Exceptions & Error Lines: [Extract specific FATAL_ERROR, EXCEPTION_THROWN, or limit breach lines], salesforce Possible error.. 

Root Cause Analysis: [Explain the likely technical reason for this failure based on the log context]

Web-Based Solutions: [Search for or suggest known fixes, specific Salesforce documentation, or StackExchange resolutions]
\`\`\`

**Note: Do not provide a line-by-line breakdown. Summarize the findings into a clean list.**

**If no errors found in any logs, state: "✅ No errors detected in any of the analyzed logs."**

---

## Key Extracts

\`\`\`
${keyExtracts.join('\n')}
\`\`\`

---

## Raw Log

${isTruncated ? '> **Note**: Raw log truncated due to size.\n\n' : ''}\`\`\`
${rawLogContent}
\`\`\`
`;

    return markdown;
}

/**
 * Generate analysis packet markdown file
 */
export async function generateAnalysisPacket(options: AnalysisPacketOptions): Promise<string> {
    const {
        outputFolder
    } = options;

    // Use the shared function to generate content
    const markdown = generateAnalysisContent(options);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `${timestamp}_${options.logId}.md`;
    
    // Resolve output folder relative to workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder open');
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const outputDir = path.join(workspaceRoot, outputFolder);
    const filePath = path.join(outputDir, filename);

    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });

    // Write file
    await writeFile(filePath, markdown, 'utf8');

    return filePath;
}
