// Character-based diff operations - optimized for memory efficiency
export interface DiffOperation {
    type: 'keep' | 'add' | 'remove';
    position: number;
    length?: number; // For 'keep' and 'remove' operations
    content?: string; // Only for 'add' operations
}

export function generateDiff(input1: string, input2: string): DiffOperation[] {
    const operations: DiffOperation[] = [];
    
    // Use a simple but efficient character-by-character approach
    let i = 0;
    let j = 0;
    
    while (i < input1.length || j < input2.length) {
        // Find matching sequences
        if (i < input1.length && j < input2.length && input1[i] === input2[j]) {
            // Count consecutive matching characters
            let matchStart = i;
            let matchLength = 0;
            while (i < input1.length && j < input2.length && input1[i] === input2[j]) {
                matchLength++;
                i++;
                j++;
            }
            
            operations.push({
                type: 'keep',
                position: matchStart,
                length: matchLength
            });
        } else if (i < input1.length && (j >= input2.length || input1[i] !== input2[j])) {
            // Characters in input1 that need to be removed, and corresponding characters in input2 to be added
            let original_i = i;
            let original_j = j;
            
            // Look ahead to find next matching point or end
            let nextMatchI = input1.length;
            let nextMatchJ = j; // Default if no match found involving input2
            
            // Search for a common character input1[ti] === input2[tj]
            // where ti is after current i, and tj is at or after current j.
            for (let ti = original_i + 1; ti < input1.length; ti++) {
                for (let tj = original_j; tj < input2.length; tj++) {
                    if (input1[ti] === input2[tj]) {
                        nextMatchI = ti;
                        nextMatchJ = tj;
                        break; // Found the earliest such match
                    }
                }
                if (nextMatchI < input1.length) { // If match was found in inner loop
                    break;
                }
            }
            
            // Characters from input1[original_i...nextMatchI-1] are removed
            if (nextMatchI > original_i) {
                operations.push({
                    type: 'remove',
                    position: original_i,
                    length: nextMatchI - original_i
                });
            }
            
            // Characters from input2[original_j...nextMatchJ-1] are added
            if (nextMatchJ > original_j) {
                const contentToAdd = input2.slice(original_j, nextMatchJ);
                if (contentToAdd.length > 0) {
                    operations.push({
                        type: 'add',
                        position: original_j, // Position in input2
                        content: contentToAdd
                    });
                }
            }
            
            i = nextMatchI;
            j = nextMatchJ;
        } else if (j < input2.length) {
            // Characters in input2 that need to be added, and corresponding characters in input1 to be removed
            let original_i = i;
            let original_j = j;

            // Look ahead to find next matching point or end
            let nextMatchI = i; // Default if no match found involving input1
            let nextMatchJ = input2.length;
            
            // Search for a common character input2[tj] === input1[ti]
            // where tj is after current j, and ti is at or after current i.
            for (let tj = original_j + 1; tj < input2.length; tj++) {
                for (let ti = original_i; ti < input1.length; ti++) {
                    if (input2[tj] === input1[ti]) {
                        nextMatchI = ti;
                        nextMatchJ = tj;
                        break; // Found the earliest such match
                    }
                }
                if (nextMatchJ < input2.length) { // If match was found in inner loop
                    break;
                }
            }
            
            // Characters from input1[original_i...nextMatchI-1] are removed
            if (nextMatchI > original_i) {
                operations.push({
                    type: 'remove',
                    position: original_i,
                    length: nextMatchI - original_i
                });
            }
            
            // Characters from input2[original_j...nextMatchJ-1] are added
            if (nextMatchJ > original_j) {
                const contentToAdd = input2.slice(original_j, nextMatchJ);
                if (contentToAdd.length > 0) {
                    operations.push({
                        type: 'add',
                        position: original_j, // Position in input2
                        content: contentToAdd
                    });
                }
            }
            
            i = nextMatchI;
            j = nextMatchJ;
        }
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

// Helper function to parse a diff string
export function deserializeDiff(diffStr: string): DiffOperation[] {
    return JSON.parse(diffStr);
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
    const operations: LineDiffOperation[] = [];
    let i = 0, j = 0;
    
    while (i < originalLines.length || j < newLines.length) {
        if (i < originalLines.length && j < newLines.length && originalLines[i] === newLines[j]) {
            // Lines match - keep
            let matchLength = 0;
            let matchStart = i;
            while (i < originalLines.length && j < newLines.length && originalLines[i] === newLines[j]) {
                matchLength++;
                i++;
                j++;
            }
            operations.push({
                type: 'keep',
                oldStart: matchStart,
                newStart: j - matchLength,
                lines: originalLines.slice(matchStart, matchStart + matchLength)
            });
        } else if (i < originalLines.length && (j >= newLines.length || originalLines[i] !== newLines[j])) {
            // Find next matching point for deletions
            let deleteStart = i;
            let deleteLines: string[] = [];
            let nextMatchI = originalLines.length;
            let nextMatchJ = j;
              // Look ahead to find next matching line
            for (let ti = i; ti < originalLines.length; ti++) {
                for (let tj = j; tj < newLines.length; tj++) {
                    if (originalLines[ti] === newLines[tj]) {
                        nextMatchI = ti;
                        nextMatchJ = tj;
                        break;
                    }
                }
                if (nextMatchI < originalLines.length) {
                    break;
                }
            }
            
            deleteLines = originalLines.slice(i, nextMatchI);
            if (deleteLines.length > 0) {
                operations.push({
                    type: 'remove',
                    oldStart: deleteStart,
                    newStart: j,
                    lines: deleteLines
                });
            }
            
            i = nextMatchI;
            j = nextMatchJ;
        } else if (j < newLines.length) {
            // Find next matching point for additions
            let addStart = j;
            let addLines: string[] = [];
            let nextMatchI = i;
            let nextMatchJ = newLines.length;
              // Look ahead to find next matching line
            for (let tj = j; tj < newLines.length; tj++) {
                for (let ti = i; ti < originalLines.length; ti++) {
                    if (newLines[tj] === originalLines[ti]) {
                        nextMatchI = ti;
                        nextMatchJ = tj;
                        break;
                    }
                }
                if (nextMatchJ < newLines.length) {
                    break;
                }
            }
            
            addLines = newLines.slice(j, nextMatchJ);
            if (addLines.length > 0) {
                operations.push({
                    type: 'add',
                    oldStart: i,
                    newStart: addStart,
                    lines: addLines
                });
            }
            
            i = nextMatchI;
            j = nextMatchJ;
        }
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

// Helper function to format text with middle ellipsis (same logic as formatTextForNodeDisplay)
function formatTextForDiffDisplay(text: string): string {
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
            for (const line of op.lines) {
                addedChars += line.length;
                // Count newlines except for the last line (since split removes the final newline)
                if (op.lines.indexOf(line) < op.lines.length - 1) {
                    addedChars += 1; // for the newline character
                }
            }
            
            // For display purposes, join with space
            const rawContent = op.lines.join(' ');
            
            // Check if there's actual content (not just whitespace)
            if (rawContent.trim()) {
                hasContentChanges = true;
                const formattedContent = formatTextForDiffDisplay(rawContent);
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
            for (const line of op.lines) {
                removedChars += line.length;
                // Count newlines except for the last line
                if (op.lines.indexOf(line) < op.lines.length - 1) {
                    removedChars += 1; // for the newline character
                }
            }
            
            // For display purposes, join with space
            const rawContent = op.lines.join(' ');
            
            // Check if there's actual content (not just whitespace)
            if (rawContent.trim()) {
                hasContentChanges = true;
                const formattedContent = formatTextForDiffDisplay(rawContent);
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
