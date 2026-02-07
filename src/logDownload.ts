import { downloadApexLog } from './sfCli';

/**
 * Download an Apex log by ID
 */
export async function downloadLog(logId: string, orgAlias?: string): Promise<string> {
    try {
        const { downloadApexLog } = await import('./sfCli');
        const content = await downloadApexLog(logId, orgAlias);
        return content;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to download log ${logId}: ${message}`);
    }
}
