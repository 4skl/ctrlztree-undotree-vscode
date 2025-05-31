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
