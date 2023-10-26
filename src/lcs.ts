// translation from js helped by https://js2ts.com/
function lcs(input1: string, input2: string, ret_cache: boolean = false): [string, string[][]] {
    const cache: string[][] = Array.from({ length: input1.length + 1 }, () => Array(input2.length + 1).fill(''));
    let i: number = 1;
    let j: number = 1;
    for (; i <= input1.length; i++) {
        for (; j <= input2.length; j++) {
            if (input1[i - 1] === input2[j - 1]) {
                cache[i][j] = cache[i - 1][j - 1] + input1[i - 1];
            }
            else {
                cache[i][j] = [cache[i][j - 1], cache[i - 1][j]].reduce((a, b) => a.length >= b.length ? a : b);
            }
        }
    }
    i--;
    j--;
    return [cache[i][j], cache];
}

export function lcs_diff(input1: string, input2: string): [string, string[][], number, number, number] {
    let start: number = 1;
    let i_end: number = input1.length;
    let j_end: number = input2.length;
    while (start <= i_end && start <= j_end && input1[start - 1] === input2[start - 1]) {
        start++;
    }
    while (start <= i_end && start <= j_end && input1[i_end - 1] === input2[j_end - 1]) {
        i_end--;
        j_end--;
    }
    const [lcs_out, cache] = lcs(input1.slice(start - 1, i_end), input2.slice(start - 1, j_end), true);
    return [input1.slice(0, start - 1) + lcs_out + input1.slice(i_end), cache, start, i_end, j_end];
}

function print_diff(input1: string, input2: string, cache: string[][] | null = null, i: number | null = null, j: number | null = null): void {
    let t_input1: string = input1;
    let t_input2: string = input2;
    let f_it: boolean = false;

    // defined for good measure
    let i_end: number = 0;
    let j_end: number = 0;
    let start: number = 0;
    //

    if (cache === null) {
        const [_, cacheData, startData, i_endData, j_endData] = lcs_diff(input1, input2);
        for (let c of input1.slice(0, startData - 1)) {
            console.log(" ", c);
        }
        t_input1 = input1.slice(startData - 1, i_endData);
        t_input2 = input2.slice(startData - 1, j_endData);
        f_it = true;
        cache = cacheData;
        start = startData;
        i_end = i_endData;
        j_end = j_endData;
    }
    if (i === null) {
        i = t_input1.length;
    }
    if (j === null) {
        j = t_input2.length;
    }
    if (i > 0 && j > 0 && t_input1[i - 1] === t_input2[j - 1]) {
        print_diff(t_input1, t_input2, cache, i - 1, j - 1);
        console.log(" ", t_input1[i - 1]);
    }
    else if (j > 0 && (i === 0 || cache[i][j - 1].length >= cache[i - 1][j].length)) {
        print_diff(t_input1, t_input2, cache, i, j - 1);
        console.log("+", t_input2[j - 1]);
    }
    else if (i > 0 && (j === 0 || cache[i][j - 1].length < cache[i - 1][j].length)) {
        print_diff(t_input1, t_input2, cache, i - 1, j);
        console.log("-", t_input1[i - 1]);
    }
    else {
        console.log("");
    }
    if (f_it) {
        for (let c of input1.slice(i_end)) {
            console.log(" ", c);
        }
    }
}

// Example usage:
const input1: string = "ABCBDAB";
const input2: string = "BDCAB";
print_diff(input1, input2);
