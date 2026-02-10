import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { OrgUserInfo } from './sfCli';
import { extractKeyLines } from './logParser';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);

/** Exact prompt for Cursor AI to analyze all logs in .debugforce/logs */
export const AGENTFORCE_ANALYSIS_PROMPT = `You are an expert Salesforce log analyst.

Task:
1) Recursively scan all text files under: .debugforce/logs
2) Detect and classify Salesforce error types and error signals, then produce a summary report.

Primary error tokens to detect (exact match + case-insensitive match):
- WF_FLOW_ACTION_ERROR
- WF_FLOW_ACTION_ERROR_DETAIL
- FLOW_CREATE_INTERVIEW_ERROR
- FLOW_START_INTERVIEWS_ERROR
- FLOW_ELEMENT_FAULT
- FLOW_ELEMENT_ERROR
- INVOCABLE_ACTION_ERROR
- VALIDATION_FAIL
- VALIDATION_ERROR
- XDS_RESPONSE_ERROR
- EXCEPTION_THROWN
- FATAL_ERROR
- USER_DEBUG_ERROR
- APP_ANALYTICS_ERROR
- TEMPLATE_PROCESSING_ERROR
- NBA_STRATEGY_ERROR
- NBA_NODE_ERROR
- PUSH_NOTIFICATION_INVALID_CERTIFICATE
- PUSH_NOTIFICATION_INVALID_APP
- PUSH_NOTIFICATION_INVALID_NOTIFICATION

Also detect general Salesforce error patterns:
- "System." exceptions (e.g., System.DmlException, System.NullPointerException, System.CalloutException, System.QueryException)
- "FATAL_ERROR"
- "EXCEPTION_THROWN"
- Lines containing: "error", "exception", "fail", "fault", "invalid" (case-insensitive)
- Governor limit failures (e.g., "Too many SOQL queries", "Apex CPU time limit exceeded", "Heap size too large", "Too many DML statements")

For each detected error instance, capture:
- file path
- timestamp (if present)
- user / request id / transaction id / correlation id (if present)
- the error type (best label)
- the specific exception message line
- the 10 lines before and 10 lines after (context window)

Output:
A) Executive summary: total files scanned, total errors found, unique error types, top 5 most frequent.
B) A table grouped by error type:
   - count
   - top 3 example messages
   - top files where it happens
C) "Most likely root causes" section (brief) for each top error type.
D) Actionable next steps: what to check in code/config, and what extra log categories/levels would help.

Rules:
- Do not hallucinate details that aren't in the logs.
- If a file looks binary or unreadable, skip it and note it.
- Prefer exact event tokens when present; otherwise fall back to exception class/message patterns.
`;

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

${AGENTFORCE_ANALYSIS_PROMPT}

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
