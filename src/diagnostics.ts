import * as vscode from 'vscode';
import { getLoggedInUser, executeSfCli } from './sfCli';

/**
 * Run diagnostics to check Debugforce setup
 */
export async function runDiagnostics(): Promise<string> {
    const diagnostics: string[] = [];
    
    diagnostics.push('=== Debugforce Diagnostics ===\n');
    
    // Check 1: Salesforce CLI availability
    try {
        const cliCheck = await executeSfCli(['--version']);
        if (cliCheck.success) {
            diagnostics.push('✓ Salesforce CLI is installed');
            diagnostics.push(`  Version: ${cliCheck.stdout.trim()}`);
        } else {
            diagnostics.push('✗ Salesforce CLI check failed');
        }
    } catch (error) {
        diagnostics.push(`✗ Salesforce CLI not found: ${error}`);
    }
    
    diagnostics.push('');
    
    // Check 2: Authenticated user
    try {
        const userInfo = await getLoggedInUser();
        diagnostics.push('✓ User is authenticated');
        diagnostics.push(`  UserId: ${userInfo.userId}`);
        diagnostics.push(`  Username: ${userInfo.username}`);
        diagnostics.push(`  Org Alias: ${userInfo.orgAlias || 'N/A'}`);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.push(`✗ User authentication failed: ${message}`);
    }
    
    diagnostics.push('');
    
    // Check 3: DebugLevel access
    try {
        const debugLevelCheck = await executeSfCli([
            'data', 'query',
            '--query', 'SELECT Id, DeveloperName FROM DebugLevel LIMIT 1',
            '--use-tooling-api',
            '--json'
        ]);
        
        if (debugLevelCheck.success) {
            try {
                const json = JSON.parse(debugLevelCheck.stdout);
                const records = json.result?.records || json.records || [];
                if (records.length > 0) {
                    diagnostics.push('✓ Can query DebugLevel');
                } else {
                    diagnostics.push('⚠ Can query DebugLevel but no records found (may need permissions)');
                }
            } catch {
                diagnostics.push('⚠ DebugLevel query succeeded but response format unexpected');
            }
        } else {
            diagnostics.push(`✗ Cannot query DebugLevel: ${debugLevelCheck.stderr || debugLevelCheck.stdout}`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.push(`✗ DebugLevel query failed: ${message}`);
    }
    
    diagnostics.push('');
    
    // Check 4: TraceFlag access
    try {
        const traceFlagCheck = await executeSfCli([
            'data', 'query',
            '--query', 'SELECT Id FROM TraceFlag LIMIT 1',
            '--use-tooling-api',
            '--json'
        ]);
        
        if (traceFlagCheck.success) {
            diagnostics.push('✓ Can query TraceFlag');
        } else {
            diagnostics.push(`✗ Cannot query TraceFlag: ${traceFlagCheck.stderr || traceFlagCheck.stdout}`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.push(`✗ TraceFlag query failed: ${message}`);
    }
    
    diagnostics.push('');
    
    // Check 5: ApexLog access
    try {
        const userInfo = await getLoggedInUser();
        const apexLogCheck = await executeSfCli([
            'data', 'query',
            '--query', `SELECT Id FROM ApexLog WHERE LogUserId = '${userInfo.userId}' LIMIT 1`,
            '--json'
        ]);
        
        if (apexLogCheck.success) {
            try {
                const json = JSON.parse(apexLogCheck.stdout);
                const records = json.result?.records || json.records || [];
                diagnostics.push(`✓ Can query ApexLog (found ${records.length} recent log(s))`);
            } catch {
                diagnostics.push('⚠ ApexLog query succeeded but response format unexpected');
            }
        } else {
            diagnostics.push(`✗ Cannot query ApexLog: ${apexLogCheck.stderr || apexLogCheck.stdout}`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        diagnostics.push(`✗ ApexLog query failed: ${message}`);
    }
    
    diagnostics.push('\n=== End Diagnostics ===');
    
    return diagnostics.join('\n');
}
