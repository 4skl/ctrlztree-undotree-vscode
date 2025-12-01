import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { generateDiff, applyDiff, serializeDiff, deserializeDiff } from '../lcs';

export interface TreeNode {
    hash: string;
    parent: string | null;
    children: string[];
    diff: string | null;
    timestamp: number;
    cursorPosition?: vscode.Position;
}

export class CtrlZTree {
    private nodes: Map<string, TreeNode>;
    private head: string | null;
    private readonly trueEmptyRootContent: string = '';
    private readonly trueEmptyRootHash: string;
    private initialSnapshotHash: string | null;

    constructor(initialDocumentContent: string) {
        this.nodes = new Map<string, TreeNode>();
        this.trueEmptyRootHash = this.calculateHash(this.trueEmptyRootContent);
        this.initialSnapshotHash = null;

        const trueEmptyRootNode: TreeNode = {
            hash: this.trueEmptyRootHash,
            parent: null,
            children: [],
            diff: null,
            timestamp: Date.now()
        };
        this.nodes.set(this.trueEmptyRootHash, trueEmptyRootNode);
        this.head = this.trueEmptyRootHash;

        if (initialDocumentContent !== this.trueEmptyRootContent) {
            const initialHash = this.set(initialDocumentContent);
            this.initialSnapshotHash = initialHash;
        }
    }

    private calculateHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    private reconstructContent(hash: string): string {
        const path = this.getPathToRoot(hash);
        let content = this.trueEmptyRootContent;

        for (let i = path.length - 2; i >= 0; i--) {
            const node = this.nodes.get(path[i])!;
            if (node.diff) {
                const diffOps = deserializeDiff(node.diff);
                content = applyDiff(content, diffOps);
            }
        }
        return content;
    }

    private getPathToRoot(hash: string): string[] {
        const path: string[] = [];
        let currentHash = hash;

        while (currentHash) {
            path.push(currentHash);
            const node = this.nodes.get(currentHash);
            if (!node || node.parent === null) {
                break;
            }
            currentHash = node.parent;
        }

        return path;
    }

    set(content: string, cursorPosition?: vscode.Position): string {
        const newHash = this.calculateHash(content);

        if (this.nodes.has(newHash)) {
            this.head = newHash;
            return newHash;
        }

        const currentContent = this.head ? this.reconstructContent(this.head) : this.trueEmptyRootContent;

        const diffOps = generateDiff(currentContent, content);
        const serializedDiff = serializeDiff(diffOps);
        const node: TreeNode = {
            hash: newHash,
            parent: this.head,
            children: [],
            diff: serializedDiff,
            timestamp: Date.now(),
            cursorPosition: cursorPosition
        };

        if (this.head) {
            const parent = this.nodes.get(this.head)!;
            parent.children.push(newHash);
        }

        this.nodes.set(newHash, node);
        this.head = newHash;
        return newHash;
    }

    z(): string | null {
        if (!this.head) {
            return null;
        }

        const currentNode = this.nodes.get(this.head)!;
        if (currentNode.parent) {
            if (currentNode.parent === this.trueEmptyRootHash) {
                if (this.initialSnapshotHash && currentNode.hash === this.initialSnapshotHash) {
                    return null;
                }
                this.head = currentNode.parent;
                return this.head;
            }
            this.head = currentNode.parent;
            return this.head;
        }
        return null;
    }

    findLatestNonEmptyState(): string | null {
        if (!this.head) {
            return null;
        }

        const currentContent = this.getContent(this.head);
        if (currentContent.trim() !== '') {
            return this.head;
        }

        let latestNonEmptyHash: string | null = null;
        let latestTimestamp = 0;

        for (const [hash, node] of this.nodes) {
            if (hash === this.trueEmptyRootHash) {
                continue;
            }

            const content = this.getContent(hash);
            if (content.trim() !== '' && node.timestamp > latestTimestamp) {
                latestNonEmptyHash = hash;
                latestTimestamp = node.timestamp;
            }
        }

        return latestNonEmptyHash;
    }

    zToLatestNonEmpty(): string | null {
        const latestNonEmpty = this.findLatestNonEmptyState();
        if (latestNonEmpty && latestNonEmpty !== this.head) {
            this.head = latestNonEmpty;
            return this.head;
        }
        return null;
    }

    y(): string | string[] {
        if (!this.head) {
            return [];
        }

        const currentNode = this.nodes.get(this.head)!;
        if (currentNode.children.length === 1) {
            this.head = currentNode.children[0];
            return this.head;
        }
        return currentNode.children;
    }

    getHead(): string | null {
        return this.head;
    }

    setHead(hash: string): boolean {
        if (this.nodes.has(hash)) {
            this.head = hash;
            return true;
        }
        return false;
    }

    getContent(hash?: string): string {
        const targetHash = hash || this.head;
        if (!targetHash || !this.nodes.has(targetHash)) {
            return this.trueEmptyRootContent;
        }
        return this.reconstructContent(targetHash);
    }

    getCursorPosition(hash?: string): vscode.Position | undefined {
        const targetHash = hash || this.head;
        if (!targetHash || !this.nodes.has(targetHash)) {
            return undefined;
        }
        return this.nodes.get(targetHash)!.cursorPosition;
    }

    getAllNodes(): Map<string, TreeNode> {
        return new Map(this.nodes);
    }

    getInternalRootHash(): string {
        return this.trueEmptyRootHash;
    }
}
