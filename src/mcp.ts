import * as vscode from 'vscode';

/**
 * Interface for MCP tool result
 */
export interface McpSoqlResult {
    records: Array<{
        Id?: string;
        LogUserId?: string;
        Operation?: string;
        StartTime?: string;
        DurationMilliseconds?: number;
        LogLength?: number;
        [key: string]: any;
    }>;
    totalSize?: number;
    done?: boolean;
}

/**
 * Call Salesforce MCP run_soql_query tool
 * 
 * Note: VS Code extensions don't have direct access to MCP servers.
 * This function is a placeholder for future Cursor-specific MCP integration.
 * 
 * If Cursor provides APIs to call MCP tools from extensions, implement here.
 * For example:
 * - Cursor might expose MCP tools via vscode API extensions
 * - Or provide a way to communicate with MCP servers
 * 
 * Currently, the extension uses CLI fallback (runSoqlQueryViaCli) which works
 * reliably across all platforms.
 */
export async function runSoqlQuery(query: string): Promise<McpSoqlResult> {
    // TODO: If Cursor provides MCP API access, implement here
    // Example (hypothetical):
    // const mcpClient = vscode.extensions.getExtension('cursor.mcp');
    // return await mcpClient.callTool('run_soql_query', { query });
    
    // For now, always use CLI fallback
    throw new Error('MCP integration not yet available - using CLI fallback');
}

/**
 * Fallback: Use Salesforce CLI for SOQL queries when MCP is not available
 */
export async function runSoqlQueryViaCli(query: string): Promise<McpSoqlResult> {
    const { executeSfCli } = await import('./sfCli');
    
    console.log('Executing SOQL query:', query);
    
    // Escape the query for CLI (though spawn handles this safely)
    const result = await executeSfCli([
        'data', 'query',
        '--query', query,
        '--json'
    ]);

    if (!result.success) {
        const errorOutput = result.stderr || result.stdout;
        console.error('SOQL query failed:', errorOutput);
        
        // Try to parse error details
        try {
            const errorJson = JSON.parse(errorOutput);
            const errorMsg = errorJson.message || errorJson.error || errorOutput;
            throw new Error(`SOQL query failed: ${errorMsg}`);
        } catch {
            throw new Error(`SOQL query failed: ${errorOutput}`);
        }
    }

    try {
        const json = JSON.parse(result.stdout);
        const resultObj = json.result || json;
        
        console.log(`SOQL query returned ${resultObj.records?.length || 0} records`);
        
        return {
            records: resultObj.records || [],
            totalSize: resultObj.totalSize || resultObj.records?.length || 0,
            done: resultObj.done !== false
        };
    } catch (error) {
        if (error instanceof SyntaxError) {
            console.error('Failed to parse query result:', result.stdout);
            throw new Error(`Failed to parse query result: ${result.stdout}`);
        }
        throw error;
    }
}

/**
 * Main entry point for SOQL queries
 * Tries MCP first, falls back to CLI
 */
export async function queryApexLogs(
    userId: string,
    startTime: string,
    maxLogs: number
): Promise<McpSoqlResult> {
    // Format SOQL query
    // IMPORTANT: StartTime is a DateTime field and should NOT be enclosed in quotes
    // Use the datetime value directly: YYYY-MM-DDTHH:mm:ss+00:00
    const query = `SELECT Id, LogUserId, Operation, StartTime, DurationMilliseconds, LogLength ` +
        `FROM ApexLog ` +
        `WHERE LogUserId = '${userId}' ` +
        `AND StartTime >= ${startTime} ` +
        `ORDER BY StartTime DESC ` +
        `LIMIT ${maxLogs}`;

    try {
        // Try MCP first (if available in Cursor)
        return await runSoqlQuery(query);
    } catch {
        // Fall back to CLI
        return await runSoqlQueryViaCli(query);
    }
}
