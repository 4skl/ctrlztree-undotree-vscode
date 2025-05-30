// translation from js helped by https://js2ts.com/
export function lcs(input1: string, input2: string, ret_cache = false): [string, string[][]] | string {
    const cache: string[][] = Array.from({ length: input1.length + 1 }, () => Array(input2.length + 1).fill(''));
    let i = 1;
    let j = 1;
    
    for (; i <= input1.length; i++) {
        for (j = 1; j <= input2.length; j++) {
            if (input1[i - 1] === input2[j - 1]) {
                cache[i][j] = cache[i - 1][j - 1] + input1[i - 1];
            }
            else {
                cache[i][j] = cache[i][j - 1].length >= cache[i - 1][j].length 
                    ? cache[i][j - 1] 
                    : cache[i - 1][j];
            }
        }
    }
    i--;
    j--;
    
    if (ret_cache) {
        return [cache[i][j], cache];
    }
    return cache[i][j];
}

export function lcsm(input1: string, input2: string, ret_cache = false): [string, string[][]] | string {
    let start = 1;
    let i_end = input1.length;
    let j_end = input2.length;
    
    // Trim off matching items at the beginning
    while (start <= i_end && start <= j_end && input1[start - 1] === input2[start - 1]) {
        start++;
    }
    
    // Trim off matching items at the end
    while (start <= i_end && start <= j_end && input1[i_end - 1] === input2[j_end - 1]) {
        i_end--;
        j_end--;
    }
    
    if (!ret_cache) {
        const lcsResult = lcs(input1.slice(start - 1, i_end), input2.slice(start - 1, j_end)) as string;
        return input1.slice(0, start - 1) + lcsResult + input1.slice(i_end);
    } else {
        const [lcsOut, cache] = lcs(input1.slice(start - 1, i_end), input2.slice(start - 1, j_end), true) as [string, string[][]];
        return [input1.slice(0, start - 1) + lcsOut + input1.slice(i_end), cache];
    }
}

export function lcs_diff(input1: string, input2: string): [string, string[][], number, number, number] {
    let start = 1;
    let i_end = input1.length;
    let j_end = input2.length;
    
    // Trim off matching items at the beginning
    while (start <= i_end && start <= j_end && input1[start - 1] === input2[start - 1]) {
        start++;
    }
    
    // Trim off matching items at the end
    while (start <= i_end && start <= j_end && input1[i_end - 1] === input2[j_end - 1]) {
        i_end--;
        j_end--;
    }
    
    const [lcsOut, cache] = lcs(input1.slice(start - 1, i_end), input2.slice(start - 1, j_end), true) as [string, string[][]];
    return [input1.slice(0, start - 1) + lcsOut + input1.slice(i_end), cache, start, i_end, j_end];
}

// Create a structured diff format
export interface DiffOperation {
    type: 'keep' | 'add' | 'remove';
    content: string;
}

export function generateDiff(input1: string, input2: string): DiffOperation[] {
    const [_, cache, start, i_end, j_end] = lcs_diff(input1, input2);
    const t_input1 = input1.slice(start - 1, i_end);
    const t_input2 = input2.slice(start - 1, j_end);
    
    const operations: DiffOperation[] = [];
    
    // First, add any common prefix
    if (start > 1) {
        operations.push({
            type: 'keep',
            content: input1.slice(0, start - 1)
        });
    }
    
    // Process the middle differing part
    processDiff(t_input1, t_input2, cache, t_input1.length, t_input2.length, operations);
    
    // Finally, add any common suffix
    if (i_end < input1.length) {
        operations.push({
            type: 'keep',
            content: input1.slice(i_end)
        });
    }
    
    return operations;
}

function processDiff(
    text1: string, 
    text2: string, 
    cache: string[][], 
    i: number, 
    j: number, 
    operations: DiffOperation[]
): void {
    if (i > 0 && j > 0 && text1[i - 1] === text2[j - 1]) {
        processDiff(text1, text2, cache, i - 1, j - 1, operations);
        operations.push({
            type: 'keep',
            content: text1[i - 1]
        });
    } else if (j > 0 && (i === 0 || cache[i][j - 1].length >= cache[i - 1][j].length)) {
        processDiff(text1, text2, cache, i, j - 1, operations);
        operations.push({
            type: 'add',
            content: text2[j - 1]
        });
    } else if (i > 0 && (j === 0 || cache[i][j - 1].length < cache[i - 1][j].length)) {
        processDiff(text1, text2, cache, i - 1, j, operations);
        operations.push({
            type: 'remove',
            content: text1[i - 1]
        });
    }
}

export function applyDiff(content: string, operations: DiffOperation[]): string {
    let result = '';
    
    for (const op of operations) {
        switch (op.type) {
            case 'keep':
                result += op.content;
                break;
            case 'add':
                result += op.content;
                break;
            case 'remove':
                // Skip this character
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

// Example usage:
// const input1 = "ABCBDAB";
// const input2 = "BDCAB";
// print_diff(input1, input2);
