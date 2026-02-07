/**
 * Extract key lines from raw Apex log content
 */
export function extractKeyLines(logContent: string, maxLines: number = 300): string[] {
    const keyTokens = [
        'EXCEPTION_THROWN',
        'FATAL_ERROR',
        'UNHANDLED_EXCEPTION',
        'LIMIT_USAGE',
        'SOQL_EXECUTE_BEGIN',
        'DML_BEGIN',
        'FLOW_START_INTERVIEW',
        'FLOW_ELEMENT_START',
        'FLOW_ELEMENT_END',
        'FLOW_ELEMENT_ERROR',
        'FLOW_ELEMENT_FAULT',
        'FLOW_INTERVIEW_FINISHED',
        'FLOW_INTERVIEW_PAUSED',
        'FLOW_CREATE_INTERVIEW_ERROR',
        'CALLOUT_REQUEST',
        'METHOD_ENTRY',
        'METHOD_EXIT',
        'CODE_UNIT_STARTED',
        'CODE_UNIT_FINISHED',
        'EXECUTION_STARTED',
        'EXECUTION_FINISHED'
    ];

    const lines = logContent.split('\n');
    const extracted: string[] = [];
    const seen = new Set<string>(); // Avoid duplicates

    for (const line of lines) {
        if (extracted.length >= maxLines) {
            break;
        }

        // Check if line contains any key token
        const containsToken = keyTokens.some(token => line.includes(token));
        
        if (containsToken) {
            const trimmed = line.trim();
            // Avoid exact duplicates
            if (!seen.has(trimmed)) {
                extracted.push(trimmed);
                seen.add(trimmed);
            }
        }
    }

    return extracted;
}
