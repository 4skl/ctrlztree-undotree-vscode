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
            // Characters in input1 that need to be removed
            let removeStart = i;
            let removeLength = 0;
              // Look ahead to find next matching point or end
            let nextMatchI = input1.length;
            let nextMatchJ = j;
            
            for (let ti = i + 1; ti < input1.length; ti++) {
                for (let tj = j; tj < input2.length; tj++) {
                    if (input1[ti] === input2[tj]) {
                        nextMatchI = ti;
                        nextMatchJ = tj;
                        break;
                    }
                }
                if (nextMatchI < input1.length) {
                    break;
                }
            }
            
            removeLength = nextMatchI - i;
            
            operations.push({
                type: 'remove',
                position: removeStart,
                length: removeLength
            });
            
            i = nextMatchI;
            j = nextMatchJ;
        } else if (j < input2.length) {
            // Characters in input2 that need to be added
            let addStart = j;
            let addContent = '';
              // Look ahead to find next matching point or end
            let nextMatchI = i;
            let nextMatchJ = input2.length;
            
            for (let tj = j + 1; tj < input2.length; tj++) {
                for (let ti = i; ti < input1.length; ti++) {
                    if (input2[tj] === input1[ti]) {
                        nextMatchI = ti;
                        nextMatchJ = tj;
                        break;
                    }
                }
                if (nextMatchJ < input2.length) {
                    break;
                }
            }
            
            addContent = input2.slice(j, nextMatchJ);
            
            operations.push({
                type: 'add',
                position: addStart,
                content: addContent
            });
            
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

// Generate a concise diff summary for tooltips
export function generateDiffSummary(originalContent: string, newContent: string): string {
    const originalLines = originalContent.split('\n');
    const newLines = newContent.split('\n');
    const lineDiff = generateLineDiff(originalLines, newLines);
    
    const changes: string[] = [];
    let addedLines = 0;
    let removedLines = 0;
    
    for (const op of lineDiff) {
        if (op.type === 'add') {
            addedLines += op.lines.length;
            // Show preview of added content
            const preview = op.lines.slice(0, 2).join(' ').substring(0, 100);
            if (preview.trim()) {
                changes.push(`+${preview}${op.lines.length > 2 || preview.length >= 100 ? '...' : ''}`);
            }
        } else if (op.type === 'remove') {
            removedLines += op.lines.length;
            // Show preview of removed content
            const preview = op.lines.slice(0, 2).join(' ').substring(0, 100);
            if (preview.trim()) {
                changes.push(`-${preview}${op.lines.length > 2 || preview.length >= 100 ? '...' : ''}`);
            }
        }
    }
    
    if (changes.length === 0) {
        return "No changes";
    }
    
    const summary = `${addedLines > 0 ? `+${addedLines}` : ''}${removedLines > 0 ? ` -${removedLines}` : ''} lines`;
    return `${summary}\n${changes.slice(0, 3).join('\n')}${changes.length > 3 ? '\n...' : ''}`;
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
