import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { downloadLog } from './logDownload';

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);

/**
 * Download raw log file with original name
 * If file exists, overwrites it
 */
export async function downloadRawLog(
    logId: string,
    orgAlias?: string,
    outputFolder: string = '.debugforce/logs'
): Promise<string> {
    // Download log content
    const logContent = await downloadLog(logId, orgAlias);
    
    // Resolve output folder relative to workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder open');
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const outputDir = path.join(workspaceRoot, outputFolder);
    
    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });

    // Use logId as filename (original name)
    const filename = `${logId}.log`;
    const filePath = path.join(outputDir, filename);

    // Check if file exists
    let fileExists = false;
    try {
        await access(filePath);
        fileExists = true;
    } catch {
        // File doesn't exist, that's fine
    }

    // Write file (overwrites if exists)
    await writeFile(filePath, logContent, 'utf8');

    return filePath;
}
