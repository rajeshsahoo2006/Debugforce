import * as vscode from 'vscode';
import { getLoggedInUser, OrgUserInfo } from './sfCli';

let cachedUserInfo: OrgUserInfo | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the currently logged-in Salesforce user info (with caching)
 */
export async function getCurrentUser(): Promise<OrgUserInfo> {
    const now = Date.now();
    
    // Return cached value if still valid
    if (cachedUserInfo && (now - cacheTimestamp) < CACHE_TTL_MS) {
        return cachedUserInfo;
    }

    try {
        cachedUserInfo = await getLoggedInUser();
        cacheTimestamp = now;
        return cachedUserInfo;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Debugforce: ${message}`);
        throw error;
    }
}

/**
 * Clear the cached user info (useful after org changes)
 */
export function clearUserCache(): void {
    cachedUserInfo = null;
    cacheTimestamp = 0;
}

/**
 * Get the SFCLILoggedInUserId (the only user allowed for log filtering)
 */
export async function getSFCLILoggedInUserId(): Promise<string> {
    const userInfo = await getCurrentUser();
    return userInfo.userId;
}
