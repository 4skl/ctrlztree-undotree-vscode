// Test script to verify character-based diff efficiency
const fs = require('fs');

// Simple implementation of the new diff operations for testing
function generateDiff(input1, input2) {
    const operations = [];
    let i = 0;
    let j = 0;
    
    while (i < input1.length || j < input2.length) {
        if (i < input1.length && j < input2.length && input1[i] === input2[j]) {
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
            let removeStart = i;
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
            
            let removeLength = nextMatchI - i;
            
            operations.push({
                type: 'remove',
                position: removeStart,
                length: removeLength
            });
            
            i = nextMatchI;
            j = nextMatchJ;
        } else if (j < input2.length) {
            let addStart = j;
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
            
            let addContent = input2.slice(j, nextMatchJ);
            
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

// Test with a realistic scenario - adding a line to a large document
console.log('Testing character-based diff efficiency...\n');

const originalText = 'Hello World!\nThis is line 2\nThis is line 3\nThis is line 4\nThis is line 5';
const modifiedText = 'Hello World!\nThis is line 2\nNEW LINE INSERTED HERE\nThis is line 3\nThis is line 4\nThis is line 5';

console.log('Original text:', originalText.length, 'characters');
console.log('Modified text:', modifiedText.length, 'characters');

const diff = generateDiff(originalText, modifiedText);
const diffSize = JSON.stringify(diff).length;

console.log('\nDiff operations:');
diff.forEach((op, i) => {
    if (op.type === 'keep') {
        console.log(`${i + 1}. Keep ${op.length} chars from position ${op.position}`);
    } else if (op.type === 'add') {
        console.log(`${i + 1}. Add "${op.content}" at position ${op.position}`);
    } else if (op.type === 'remove') {
        console.log(`${i + 1}. Remove ${op.length} chars from position ${op.position}`);
    }
});

console.log(`\nDiff storage size: ${diffSize} bytes`);
console.log(`Original text size: ${originalText.length} bytes`);
console.log(`Memory efficiency: ${((1 - diffSize / originalText.length) * 100).toFixed(1)}% less storage than storing full content`);

// Test reconstruction
function applyDiff(originalContent, operations) {
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
                break;
        }
    }
    
    return result;
}

const reconstructed = applyDiff(originalText, diff);
console.log(`\nReconstruction successful: ${reconstructed === modifiedText}`);

if (reconstructed !== modifiedText) {
    console.log('Expected:', modifiedText);
    console.log('Got:', reconstructed);
}
