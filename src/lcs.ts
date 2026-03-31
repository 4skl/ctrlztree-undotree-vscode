// Character-based diff operations - optimized for memory efficiency
export interface DiffOperation {
    type: 'keep' | 'add' | 'remove';
    position: number;
    length?: number; // For 'keep' and 'remove' operations
    content?: string; // Only for 'add' operations
}

export function generateDiff(input1: string, input2: string): DiffOperation[] {
    const operations: DiffOperation[] = [];
    
    // Compute Longest Common Subsequence using dynamic programming
    const m = input1.length;
    const n = input2.length;
    const lcs: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
    
    // Fill the LCS table
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (input1[i - 1] === input2[j - 1]) {
                lcs[i][j] = lcs[i - 1][j - 1] + 1;
            } else {
                lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
            }
        }
    }
    
    // Backtrack to build the diff operations
    let i = m;
    let j = n;
    const tempOps: DiffOperation[] = [];
    
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && input1[i - 1] === input2[j - 1]) {
            // Characters match - add to keep operations
            tempOps.push({
                type: 'keep',
                position: i - 1,
                length: 1
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
            // Character in input2 but not in LCS from input1 - it's an addition
            tempOps.push({
                type: 'add',
                position: j - 1,
                content: input2[j - 1]
            });
            j--;
        } else {
            // Character in input1 but not in LCS - it's a removal
            tempOps.push({
                type: 'remove',
                position: i - 1,
                length: 1
            });
            i--;
        }
    }
    
    // Reverse because we built backward
    tempOps.reverse();
    
    // Merge consecutive operations of the same type
    for (const op of tempOps) {
        if (operations.length > 0) {
            const last = operations[operations.length - 1];
            if (op.type === 'keep' && last.type === 'keep' && last.position + last.length! === op.position) {
                // Merge consecutive keep operations
                last.length = last.length! + op.length!;
                continue;
            } else if (op.type === 'add' && last.type === 'add') {
                // Merge consecutive add operations
                last.content = (last.content || '') + op.content;
                continue;
            } else if (op.type === 'remove' && last.type === 'remove' && last.position + last.length! === op.position) {
                // Merge consecutive remove operations
                last.length = last.length! + op.length!;
                continue;
            }
        }
        operations.push(op);
    }
    
    return operations;
}

export function applyDiff(originalContent: string, operations: DiffOperation[]): string {
    let result = '';
    
    for (const op of operations) {
        switch (op.type) {
            case 'keep':
                // Copy the specified length from original content at the position
                if (op.length !== undefined) {
                    result += originalContent.slice(op.position, op.position + op.length);
                }
                break;
            case 'add':
                // Add the new content
                if (op.content !== undefined) {
                    result += op.content;
                }
                break;
            case 'remove':
                // Skip - don't add anything to result
                break;
        }
    }
    
    return result;
}

// Helper function to create a simple diff string for storage
export function serializeDiff(operations: DiffOperation[]): string {
    return JSON.stringify(operations);
}

// Helper function to parse a diff string with validation
export function deserializeDiff(diffStr: string): DiffOperation[] {
    try {
        const operations = JSON.parse(diffStr);

        // Validate that result is an array
        if (!Array.isArray(operations)) {
            throw new Error('Deserialized diff is not an array');
        }

        // Validate each operation has required properties
        for (const op of operations) {
            if (!op.type || !['keep', 'add', 'remove'].includes(op.type)) {
                throw new Error(`Invalid operation type: ${op.type}`);
            }
            if (typeof op.position !== 'number' || op.position < 0) {
                throw new Error(`Invalid position in operation: ${op.position}`);
            }
            if (op.type === 'add' && typeof op.content !== 'string') {
                throw new Error('Add operation missing content');
            }
            if ((op.type === 'keep' || op.type === 'remove') &&
                (typeof op.length !== 'number' || op.length < 0)) {
                throw new Error(`Invalid length in operation: ${op.length}`);
            }
        }

        return operations;
    } catch (error) {
        throw new Error(`Failed to deserialize diff: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Generate a git-style unified diff representation
export function generateUnifiedDiff(originalContent: string, newContent: string, options?: {
    contextLines?: number;
    filename?: string;
}): string {
    const contextLines = options?.contextLines || 3;
    const filename = options?.filename || 'file';
    
    const originalLines = originalContent.split('\n');
    const newLines = newContent.split('\n');
    
    // Simple line-based diff using LCS approach
    const lineDiff = generateLineDiff(originalLines, newLines);
    
    if (lineDiff.length === 0) {
        return `--- a/${filename}\n+++ b/${filename}\n@@ No changes @@`;
    }
    
    let diffText = `--- a/${filename}\n+++ b/${filename}\n`;
    
    // Group changes into hunks
    const hunks = groupIntoHunks(lineDiff, contextLines);
    
    for (const hunk of hunks) {
        const oldStart = Math.max(1, hunk.oldStart);
        const newStart = Math.max(1, hunk.newStart);
        const oldLength = hunk.oldLength;
        const newLength = hunk.newLength;
        
        diffText += `@@ -${oldStart},${oldLength} +${newStart},${newLength} @@\n`;
        
        for (const line of hunk.lines) {
            diffText += line + '\n';
        }
    }
    
    return diffText.trim();
}

// Generate line-based diff operations
function generateLineDiff(originalLines: string[], newLines: string[]): LineDiffOperation[] {
    // Compute Longest Common Subsequence of lines using dynamic programming
    const m = originalLines.length;
    const n = newLines.length;
    const lcs: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
    
    // Fill the LCS table
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (originalLines[i - 1] === newLines[j - 1]) {
                lcs[i][j] = lcs[i - 1][j - 1] + 1;
            } else {
                lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
            }
        }
    }
    
    // Backtrack to build the diff operations
    let i = m;
    let j = n;
    const tempOps: LineDiffOperation[] = [];
    
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && originalLines[i - 1] === newLines[j - 1]) {
            // Lines match - add to keep operations
            tempOps.push({
                type: 'keep',
                oldStart: i - 1,
                newStart: j - 1,
                lines: [originalLines[i - 1]]
            });
            i--;
            j--;
        } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
            // Line in newLines but not in LCS from originalLines - it's an addition
            tempOps.push({
                type: 'add',
                oldStart: i,
                newStart: j - 1,
                lines: [newLines[j - 1]]
            });
            j--;
        } else {
            // Line in originalLines but not in LCS - it's a removal
            tempOps.push({
                type: 'remove',
                oldStart: i - 1,
                newStart: j,
                lines: [originalLines[i - 1]]
            });
            i--;
        }
    }
    
    // Reverse because we built backward
    tempOps.reverse();
    
    // Merge consecutive operations of the same type
    const operations: LineDiffOperation[] = [];
    for (const op of tempOps) {
        if (operations.length > 0) {
            const last = operations[operations.length - 1];
            if (op.type === 'keep' && last.type === 'keep' && 
                last.oldStart + last.lines.length === op.oldStart &&
                last.newStart + last.lines.length === op.newStart) {
                // Merge consecutive keep operations
                last.lines.push(...op.lines);
                continue;
            } else if (op.type === 'add' && last.type === 'add' && 
                      last.newStart + last.lines.length === op.newStart) {
                // Merge consecutive add operations
                last.lines.push(...op.lines);
                continue;
            } else if (op.type === 'remove' && last.type === 'remove' && 
                      last.oldStart + last.lines.length === op.oldStart) {
                // Merge consecutive remove operations
                last.lines.push(...op.lines);
                continue;
            }
        }
        operations.push(op);
    }
    
    return operations;
}

// Group diff operations into hunks with context
function groupIntoHunks(operations: LineDiffOperation[], contextLines: number): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    
    for (const op of operations) {
        if (op.type === 'keep') {
            if (currentHunk && op.lines.length <= contextLines * 2) {
                // Add to current hunk if it's close enough
                for (const line of op.lines) {
                    currentHunk.lines.push(` ${line}`);
                }
                currentHunk.oldLength += op.lines.length;
                currentHunk.newLength += op.lines.length;
            } else {
                // Start new hunk or close current one
                if (currentHunk) {
                    // Add trailing context to current hunk
                    const trailingContext = Math.min(contextLines, op.lines.length);
                    for (let i = 0; i < trailingContext; i++) {
                        currentHunk.lines.push(` ${op.lines[i]}`);
                    }
                    currentHunk.oldLength += trailingContext;
                    currentHunk.newLength += trailingContext;
                    hunks.push(currentHunk);
                }
                
                // Start new hunk if there are more operations after this keep
                const hasMoreChanges = operations.indexOf(op) < operations.length - 1;
                if (hasMoreChanges) {
                    const leadingContext = Math.min(contextLines, op.lines.length);
                    const contextStart = Math.max(0, op.lines.length - leadingContext);
                    
                    currentHunk = {
                        oldStart: op.oldStart + contextStart,
                        newStart: op.newStart + contextStart,
                        oldLength: leadingContext,
                        newLength: leadingContext,
                        lines: []
                    };
                    
                    for (let i = contextStart; i < op.lines.length; i++) {
                        currentHunk.lines.push(` ${op.lines[i]}`);
                    }
                } else {
                    currentHunk = null;
                }
            }
        } else {
            if (!currentHunk) {
                currentHunk = {
                    oldStart: op.oldStart,
                    newStart: op.newStart,
                    oldLength: 0,
                    newLength: 0,
                    lines: []
                };
            }
            
            if (op.type === 'remove') {
                for (const line of op.lines) {
                    currentHunk.lines.push(`-${line}`);
                }
                currentHunk.oldLength += op.lines.length;
            } else if (op.type === 'add') {
                for (const line of op.lines) {
                    currentHunk.lines.push(`+${line}`);
                }
                currentHunk.newLength += op.lines.length;
            }
        }
    }
    
    if (currentHunk) {
        hunks.push(currentHunk);
    }
    
    return hunks;
}

// Helper function to format text with middle ellipsis for display
export function formatTextForDisplay(text: string): string {
    if (!text || text.trim() === '') {
        return "Empty content";
    }

    // Clean the text: remove excessive whitespace, normalize line breaks
    const cleanText = text.replace(/\s+/g, ' ').trim();

    // Apply middle ellipsis format if text is too long
    if (cleanText.length > 80) {
        // Show first 37 chars + newline + ... + newline + last 37 chars
        return cleanText.substring(0, 37) + '\n...\n' +
               cleanText.substring(cleanText.length - 37);
    }

    return cleanText;
}

// Generate a concise diff summary for tooltips
export function generateDiffSummary(originalContent: string, newContent: string): string {
    const originalLines = originalContent.split('\n');
    const newLines = newContent.split('\n');
    const lineDiff = generateLineDiff(originalLines, newLines);
    
    const changes: string[] = [];
    const whitespaceChanges: string[] = [];
    let addedLines = 0;
    let removedLines = 0;
    let addedChars = 0;
    let removedChars = 0;
    let hasContentChanges = false;
    
    // First pass: process all operations and categorize changes
    for (const op of lineDiff) {
        if (op.type === 'add') {
            addedLines += op.lines.length;
            
            // Count all characters in added content
            for (let idx = 0; idx < op.lines.length; idx++) {
                const line = op.lines[idx];
                addedChars += line.length;
                // Count newlines except for the last line (since split removes the final newline)
                if (idx < op.lines.length - 1) {
                    addedChars += 1; // for the newline character
                }
            }
            
            // For display purposes, join with space
            const rawContent = op.lines.join(' ');
            
            // Check if there's actual content (not just whitespace)
            if (rawContent.trim()) {
                hasContentChanges = true;
                const formattedContent = formatTextForDisplay(rawContent);
                changes.push(`+${formattedContent}`);
            } else if (rawContent.length > 0) {
                // Only whitespace was added - store separately
                const description = op.lines.length === 1 && op.lines[0] === '' ? 
                    'empty line' : 
                    'whitespace';
                whitespaceChanges.push(`+${description}`);
            }
        } else if (op.type === 'remove') {
            removedLines += op.lines.length;
            
            // Count all characters in removed content
            for (let idx = 0; idx < op.lines.length; idx++) {
                const line = op.lines[idx];
                removedChars += line.length;
                // Count newlines except for the last line
                if (idx < op.lines.length - 1) {
                    removedChars += 1; // for the newline character
                }
            }
            
            // For display purposes, join with space
            const rawContent = op.lines.join(' ');
            
            // Check if there's actual content (not just whitespace)
            if (rawContent.trim()) {
                hasContentChanges = true;
                const formattedContent = formatTextForDisplay(rawContent);
                changes.push(`-${formattedContent}`);
            } else if (rawContent.length > 0) {
                // Only whitespace was removed - store separately
                const description = op.lines.length === 1 && op.lines[0] === '' ? 
                    'empty line' : 
                    'whitespace';
                whitespaceChanges.push(`-${description}`);
            }
        }
    }
    
    // Second pass: decide what to show based on whether we have content changes
    const finalChanges = hasContentChanges ? changes : [...changes, ...whitespaceChanges];
    
    // If no changes detected at all, check for direct content differences
    if (finalChanges.length === 0 && addedLines === 0 && removedLines === 0) {
        if (originalContent !== newContent) {
            // There must be some character-level changes
            const charDiff = newContent.length - originalContent.length;
            
            if (charDiff !== 0) {
                // Check if it's purely newlines
                const originalNewlines = (originalContent.match(/\r?\n/g) || []).length;
                const newNewlines = (newContent.match(/\r?\n/g) || []).length;
                const newlineDiff = newNewlines - originalNewlines;
                
                // If char change equals newline change (accounting for \r\n vs \n), it's purely newlines
                const isOnlyNewlines = Math.abs(charDiff) === Math.abs(newlineDiff) || 
                                       Math.abs(charDiff) === Math.abs(newlineDiff * 2); // for \r\n
                
                if (isOnlyNewlines && newlineDiff !== 0) {
                    return newlineDiff > 0 ? 
                        `+${newlineDiff} newline${newlineDiff !== 1 ? 's' : ''}` : 
                        `-${Math.abs(newlineDiff)} newline${Math.abs(newlineDiff) !== 1 ? 's' : ''}`;
                } else {
                    return charDiff > 0 ? `+${charDiff} chars` : `-${Math.abs(charDiff)} chars`;
                }
            } else {
                return "Character replacements";
            }
        }
        return "No changes";
    }
    
    // Build summary - show net changes
    let summary = '';
    
    // Calculate net line changes
    const netLines = addedLines - removedLines;
    if (netLines !== 0) {
        if (netLines > 0) {
            summary = `+${netLines} line${netLines !== 1 ? 's' : ''}`;
        } else {
            summary = `-${Math.abs(netLines)} line${Math.abs(netLines) !== 1 ? 's' : ''}`;
        }
    }
    
    // Calculate net character changes
    const netChars = addedChars - removedChars;
    if (netChars !== 0) {
        // Check if the changes are purely newlines
        const originalNewlines = (originalContent.match(/\r?\n/g) || []).length;
        const newNewlines = (newContent.match(/\r?\n/g) || []).length;
        const netNewlines = newNewlines - originalNewlines;
        
        // If net char change equals net newlines (accounting for \r\n vs \n), it's purely newlines
        const isOnlyNewlines = Math.abs(netChars) === Math.abs(netNewlines) || 
                               Math.abs(netChars) === Math.abs(netNewlines * 2); // for \r\n
        
        if (isOnlyNewlines && netNewlines !== 0) {
            const newlinePart = netNewlines > 0 ? 
                `+${netNewlines} newline${netNewlines !== 1 ? 's' : ''}` : 
                `-${Math.abs(netNewlines)} newline${Math.abs(netNewlines) !== 1 ? 's' : ''}`;
            if (summary) {
                summary += `, ${newlinePart}`;
            } else {
                summary = newlinePart;
            }
        } else {
            const charPart = netChars > 0 ? `+${netChars} chars` : `-${Math.abs(netChars)} chars`;
            if (summary) {
                summary += `, ${charPart}`;
            } else {
                summary = charPart;
            }
        }
    }
    
    // If no net changes but we had changes, show that
    if (!summary && (addedLines > 0 || removedLines > 0 || addedChars > 0 || removedChars > 0)) {
        summary = "Content modified";
    }
    
    return `${summary}\n${finalChanges.slice(0, 3).join('\n')}${finalChanges.length > 3 ? '\n...' : ''}`;
}

// Helper interfaces for line-based diffs
interface LineDiffOperation {
    type: 'keep' | 'add' | 'remove';
    oldStart: number;
    newStart: number;
    lines: string[];
}

interface DiffHunk {
    oldStart: number;
    newStart: number;
    oldLength: number;
    newLength: number;
    lines: string[];
}
