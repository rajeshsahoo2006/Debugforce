# Debugforce Implementation Notes

## Critical Implementation Details

### 1. SOQL Query Integration (`src/mcp.ts` and `src/logQuery.ts`)

The extension uses Salesforce MCP for SOQL queries with automatic fallback to Salesforce CLI.

**Key Implementation:**

```typescript
// src/logQuery.ts - Builds the SOQL query with proper date formatting
export async function fetchLogs(timeWindowMinutes: number, maxLogs: number): Promise<ApexLogEntry[]> {
    const userId = await getSFCLILoggedInUserId();
    
    // Calculate UTC timestamp N minutes ago
    const nMinutesAgo = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
    const startTimeIso = nMinutesAgo.toISOString();
    
    // Build SOQL date literal (format: YYYY-MM-DDTHH:mm:ss+00:00)
    const startTimeSoql = startTimeIso.replace('Z', '+00:00');
    
    // Query with defensive filtering
    const result = await queryApexLogs(userId, startTimeSoql, maxLogs);
    
    // Defensive check: filter out any records that don't match our userId
    for (const record of result.records || []) {
        if (record.LogUserId !== userId) {
            // Discard mismatched records
            continue;
        }
        // ... process valid records
    }
}
```

**SOQL Query Format:**
```sql
SELECT Id, LogUserId, Operation, StartTime, DurationMilliseconds, LogLength 
FROM ApexLog 
WHERE LogUserId = '<SFCLILoggedInUserId>' 
AND StartTime >= 'YYYY-MM-DDTHH:mm:ss+00:00' 
ORDER BY StartTime DESC 
LIMIT <maxLogs>
```

**MCP Integration Approach:**
- `runSoqlQuery()`: Placeholder for future Cursor MCP API integration
- `runSoqlQueryViaCli()`: Reliable CLI fallback using `sf data query`
- `queryApexLogs()`: Tries MCP first, falls back to CLI automatically

**Why CLI Fallback:**
VS Code extensions don't have direct access to MCP servers. The extension uses CLI as the primary method, with MCP integration ready for when Cursor provides extension APIs.

---

### 2. User Context & Filtering (`src/userContext.ts` and `src/sfCli.ts`)

**Critical Security Rule:** Only fetch logs for `SFCLILoggedInUserId`

**Implementation:**

```typescript
// src/sfCli.ts - Gets logged-in user via CLI
export async function getLoggedInUser(): Promise<OrgUserInfo> {
    const result = await executeSfCli(['org', 'display', 'user', '--json']);
    
    // Parse JSON response (handles different CLI output shapes)
    const json = JSON.parse(result.stdout);
    const resultObj = json.result || json;
    
    const userId = resultObj.id || resultObj.userId;  // Handles both formats
    const username = resultObj.username || resultObj.userName;
    const orgAlias = resultObj.alias || resultObj.orgAlias;
    
    return { userId, username, orgAlias };
}
```

**User ID Extraction Logic:**
- Handles both `id` and `userId` fields (CLI version differences)
- Handles both `username` and `userName` fields
- Validates that userId exists before proceeding
- Caches user info for 5 minutes to reduce CLI calls

**Defensive Filtering:**
1. **SOQL Level**: Query includes `WHERE LogUserId = '<SFCLILoggedInUserId>'`
2. **Application Level**: After fetching, discards any records where `LogUserId !== SFCLILoggedInUserId`
3. **Never accepts user input** for LogUserId - always uses authenticated user

---

### 3. CLI Command Execution (`src/sfCli.ts`)

**Uses `spawn` (not `exec`) for safety:**

```typescript
export async function executeSfCli(
    args: string[],
    options: { cwd?: string } = {}
): Promise<SfCliResult> {
    return new Promise((resolve) => {
        const child = spawn('sf', args, {
            cwd: options.cwd || process.cwd(),
            shell: false,  // Critical: no shell injection
            stdio: ['ignore', 'pipe', 'pipe']
        });
        // ... handle stdout/stderr
    });
}
```

**Benefits:**
- No shell quoting issues
- Safe argument handling
- Cross-platform compatibility
- Proper error handling

---

### 4. Trace Flag Management (`src/traceFlags.ts`)

**Date Handling:**
- Computes dates in TypeScript (UTC ISO)
- Does not rely on shell `date` command
- Formats for Salesforce CLI compatibility

```typescript
const now = new Date();
const expirationDate = new Date(now.getTime() + traceMinutes * 60 * 1000);
const startDateIso = now.toISOString();
const expirationDateIso = expirationDate.toISOString();
```

**Trace Flag Creation:**
1. Query for existing `CLI_Debug` DebugLevel
2. Create if missing
3. Delete existing TraceFlags for user
4. Create new TraceFlag with computed dates

---

### 5. Log Download (`src/sfCli.ts`)

**Handles Different CLI Output Shapes:**

```typescript
// CLI might return path in different formats:
// - Direct string path
// - result.path
// - result.filePath
// - result.location
// - Or in stdout text

// Also checks common log file locations:
// - ~/.sf/apex/log_<id>.log
// - ~/.sfdx/apex/log_<id>.log
// - <workspace>/.sf/apex/log_<id>.log
```

---

## Testing Recommendations

### Test Cases for `sf org display user --json` Parsing:

1. **Different CLI Versions:**
   - Test with `id` field
   - Test with `userId` field
   - Test with `username` vs `userName`

2. **Different Org Types:**
   - Production orgs
   - Sandboxes
   - Scratch orgs
   - Dev orgs

3. **Edge Cases:**
   - Missing org alias
   - Missing username
   - Invalid JSON response
   - No authenticated org

### Test Cases for SOQL Query:

1. **Date Formatting:**
   - Verify ISO date conversion
   - Test with different time zones
   - Test with edge cases (midnight, year boundaries)

2. **User Filtering:**
   - Verify only logs for authenticated user are returned
   - Test defensive filtering catches mismatched records
   - Test with multiple users' logs in org

3. **MCP vs CLI:**
   - Test CLI fallback works when MCP unavailable
   - Verify query syntax works with both methods

---

## Files to Review

1. **`src/sfCli.ts`** - `getLoggedInUser()` function (lines 45-85)
2. **`src/mcp.ts`** - `queryApexLogs()` and `runSoqlQueryViaCli()` functions
3. **`src/logQuery.ts`** - `fetchLogs()` function with defensive filtering
4. **`src/userContext.ts`** - User caching and ID retrieval

These are the critical paths that ensure:
- Only authenticated user's logs are fetched
- SOQL queries work across CLI versions
- Proper error handling and user feedback
