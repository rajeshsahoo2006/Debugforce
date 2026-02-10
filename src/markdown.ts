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

## 🤖 Cursor AI Prompt

Analyze \`${logId}.log\` in \`.debugforce/logs\` and Analyse the Logs highlight the errors Strictly only show the error Log files with valid Salesforce Errors. If the log is clean, reply "✅ No errors detected. Skip the log in Output"

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
