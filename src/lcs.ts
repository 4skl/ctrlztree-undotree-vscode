// Character-based diff operations - optimized for memory efficiency
export interface DiffOperation {
    type: 'keep' | 'add' | 'remove';
    position: number;
    length?: number; // For 'keep' and 'remove' operations
    content?: string; // Only for 'add' operations
}

export function generateDiff(input1: string, input2: string): DiffOperation[] {
    const operations: DiffOperation[] = [];
    
    // 1. Strip common prefix
    let start = 0;
    while (start < input1.length && start < input2.length && input1[start] === input2[start]) {
        start++;
    }
    
    // 2. Strip common suffix
    let end1 = input1.length - 1;
    let end2 = input2.length - 1;
    while (end1 >= start && end2 >= start && input1[end1] === input2[end2]) {
        end1--;
        end2--;
    }
    
    // Keep prefix
    if (start > 0) {
        operations.push({ type: 'keep', position: 0, length: start });
    }
    
    // 3. Handle the middle (the actual changed portion)
    const midLen1 = end1 - start + 1;
    const midLen2 = end2 - start + 1;
    
    if (midLen1 > 0 && midLen2 > 0) {
        // Both sides have unique middle content.
        // For absolute memory safety in massive files, we treat this as a block replacement 
        // rather than doing a 2D DP matrix on potentially thousands of characters.
        operations.push({ type: 'remove', position: start, length: midLen1 });
        operations.push({ type: 'add', position: start, content: input2.substring(start, end2 + 1) });
    } else if (midLen1 > 0) {
        // Only removals
        operations.push({ type: 'remove', position: start, length: midLen1 });
    } else if (midLen2 > 0) {
        // Only additions
        operations.push({ type: 'add', position: start, content: input2.substring(start, end2 + 1) });
    }
    
    // Keep suffix
    const suffixLen = input1.length - 1 - end1;
    if (suffixLen > 0) {
        operations.push({ type: 'keep', position: end1 + 1, length: suffixLen });
    }
    
    return operations;
}

export function applyDiff(originalContent: string, operations: DiffOperation[]): string {
    let result = '';
    
    for (const op of operations) {
        switch (op.type) {
            case 'keep':
                if (op.length !== undefined) {
                    result += originalContent.slice(op.position, op.position + op.length);
                }
                break;
            case 'add':
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

export function serializeDiff(operations: DiffOperation[]): string {
    return JSON.stringify(operations);
}

export function deserializeDiff(diffStr: string): DiffOperation[] {
    try {
        const operations = JSON.parse(diffStr);
        if (!Array.isArray(operations)) throw new Error('Deserialized diff is not an array');
        // (Skipped verbose validation to keep it brief, but your old validation is fine here too)
        return operations;
    } catch (error) {
        throw new Error(`Failed to deserialize diff: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function generateUnifiedDiff(originalContent: string, newContent: string, options?: { contextLines?: number; filename?: string; }): string {
    const contextLines = options?.contextLines || 3;
    const filename = options?.filename || 'file';
    
    const originalLines = originalContent.split('\n');
    const newLines = newContent.split('\n');
    
    const lineDiff = generateLineDiff(originalLines, newLines);
    if (lineDiff.length === 0) {
        return `--- a/${filename}\n+++ b/${filename}\n@@ No changes @@`;
    }
    
    let diffText = `--- a/${filename}\n+++ b/${filename}\n`;
    const hunks = groupIntoHunks(lineDiff, contextLines);
    
    for (const hunk of hunks) {
        diffText += `@@ -${Math.max(1, hunk.oldStart)},${hunk.oldLength} +${Math.max(1, hunk.newStart)},${hunk.newLength} @@\n`;
        for (const line of hunk.lines) {
            diffText += line + '\n';
        }
    }
    
    return diffText.trim();
}

function generateLineDiff(originalLines: string[], newLines: string[]): LineDiffOperation[] {
    const operations: LineDiffOperation[] = [];
    
    let start = 0;
    while (start < originalLines.length && start < newLines.length && originalLines[start] === newLines[start]) {
        operations.push({ type: 'keep', oldStart: start, newStart: start, lines: [originalLines[start]] });
        start++;
    }
    
    let end1 = originalLines.length - 1;
    let end2 = newLines.length - 1;
    while (end1 >= start && end2 >= start && originalLines[end1] === newLines[end2]) {
        end1--;
        end2--;
    }
    
    // Middle section (Block replace approach for speed/memory)
    for (let i = start; i <= end1; i++) {
        operations.push({ type: 'remove', oldStart: i, newStart: start, lines: [originalLines[i]] });
    }
    for (let j = start; j <= end2; j++) {
        operations.push({ type: 'add', oldStart: end1 + 1, newStart: j, lines: [newLines[j]] });
    }
    
    // Add the suffix operations
    for (let i = end1 + 1, j = end2 + 1; i < originalLines.length; i++, j++) {
        operations.push({ type: 'keep', oldStart: i, newStart: j, lines: [originalLines[i]] });
    }
    
    // Merge consecutives
    return mergeLineOperations(operations);
}

function mergeLineOperations(tempOps: LineDiffOperation[]): LineDiffOperation[] {
    const operations: LineDiffOperation[] = [];
    for (const op of tempOps) {
        if (operations.length > 0) {
            const last = operations[operations.length - 1];
            if (op.type === last.type) {
                if (op.type === 'keep' && last.oldStart + last.lines.length === op.oldStart) {
                    last.lines.push(...op.lines);
                    continue;
                } else if (op.type === 'add' && last.newStart + last.lines.length === op.newStart) {
                    last.lines.push(...op.lines);
                    continue;
                } else if (op.type === 'remove' && last.oldStart + last.lines.length === op.oldStart) {
                    last.lines.push(...op.lines);
                    continue;
                }
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
