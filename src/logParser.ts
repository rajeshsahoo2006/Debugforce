/**
 * Extract key lines from raw Apex log content
 * Prioritizes error-related lines and critical events
 */
export function extractKeyLines(logContent: string, maxLines: number = 300): string[] {
    // Prioritize error tokens first, then info tokens
    const errorTokens = [
        'EXCEPTION_THROWN',
        'FATAL_ERROR',
        'UNHANDLED_EXCEPTION',
        'SYSTEM_MODE_ENTER',
        'FLOW_ELEMENT_ERROR',
        'FLOW_ELEMENT_FAULT',
        'FLOW_CREATE_INTERVIEW_ERROR'
    ];

    const infoTokens = [
        'LIMIT_USAGE',
        'MAXIMUM_LIMIT_USAGE',
        'SOQL_EXECUTE_BEGIN',
        'DML_BEGIN',
        'FLOW_START_INTERVIEW',
        'FLOW_INTERVIEW_FINISHED',
        'CALLOUT_REQUEST',
        'CODE_UNIT_STARTED',
        'CODE_UNIT_FINISHED',
        'EXECUTION_STARTED',
        'EXECUTION_FINISHED'
    ];

    const lines = logContent.split('\n');
    const errorLines: string[] = [];
    const infoLines: string[] = [];
    const seen = new Set<string>(); // Avoid duplicates

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }

        // Check for error tokens first
        const hasError = errorTokens.some(token => line.includes(token));
        if (hasError) {
            errorLines.push(trimmed);
            seen.add(trimmed);
            continue;
        }

        // Then check for info tokens
        const hasInfo = infoTokens.some(token => line.includes(token));
        if (hasInfo && infoLines.length < maxLines) {
            infoLines.push(trimmed);
            seen.add(trimmed);
        }
    }

    // Combine: errors first, then info, limited by maxLines
    const combined = [...errorLines, ...infoLines];
    return combined.slice(0, maxLines);
}

/**
 * Check if a log contains errors or exceptions
 */
export function hasErrors(logContent: string): boolean {
    const errorIndicators = [
        'EXCEPTION_THROWN',
        'FATAL_ERROR',
        'UNHANDLED_EXCEPTION',
        'FLOW_ELEMENT_ERROR',
        'FLOW_ELEMENT_FAULT',
        'FLOW_CREATE_INTERVIEW_ERROR',
        'System.LimitException',
        'System.QueryException',
        'System.DmlException',
        'System.NullPointerException'
    ];

    return errorIndicators.some(indicator => logContent.includes(indicator));
}
