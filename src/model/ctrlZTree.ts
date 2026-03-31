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
    private initialSnapshotHash?: string;

    constructor(initialDocumentContent: string) {
        this.nodes = new Map<string, TreeNode>();
        this.trueEmptyRootHash = this.calculateHash(this.trueEmptyRootContent);
        this.initialSnapshotHash = this.trueEmptyRootHash;

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

        // Path is [target, parent, ..., root] - reverse it to [root, ..., parent, target]
        for (let i = path.length - 1; i >= 0; i--) {
            const node = this.nodes.get(path[i])!;
            // Skip the root node (it has no diff and content is already empty)
            if (node === this.nodes.get(this.trueEmptyRootHash)) {
                continue;
            }
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
        const currentContent = this.head ? this.reconstructContent(this.head) : this.trueEmptyRootContent;

        // Only move head to existing node if it's a valid child of current head
        if (this.nodes.has(newHash)) {
            const existingNode = this.nodes.get(newHash)!;
            // Verify the node is actually a child of the current head (or we're at root)
            if (existingNode.parent === this.head) {
                this.head = newHash;
                return newHash;
            }
            // If the node exists but is not a valid child, fall through to create a new one
        }

        // Content is the same as current head - no change needed
        if (currentContent === content && !cursorPosition) {
            return this.head || this.trueEmptyRootHash;
        }

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
        
        // Prevent undoing past the initial snapshot - don't go back before the file was opened
        if (this.head === this.initialSnapshotHash) {
            return null;
        }
        
        if (currentNode.parent) {
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

    public getInitialSnapshotHash(): string {
        return this.initialSnapshotHash ?? this.trueEmptyRootHash;
    }

    /**
     * Get the number of nodes in the history tree.
     * Useful for monitoring memory usage.
     */
    public getNodeCount(): number {
        return this.nodes.size;
    }

    /**
     * Prune the history tree to keep only the most recent nodes.
     * This prevents unbounded memory growth for long-lived editors.
     * Keeps all nodes on the path to the current head, plus recent leaf nodes.
     */
    public pruneToMaxNodes(maxNodes: number): void {
        if (this.nodes.size <= maxNodes) {
            return;
        }

        // Always keep nodes on the path to root and the current head
        const nodesToKeep = new Set<string>();

        // Keep the current head and all ancestors
        let currentHash = this.head;
        while (currentHash) {
            nodesToKeep.add(currentHash);
            const node = this.nodes.get(currentHash);
            if (!node || node.parent === null) {
                break;
            }
            currentHash = node.parent;
        }

        // If we haven't reached maxNodes yet, keep the most recent leaf nodes
        if (nodesToKeep.size < maxNodes) {
            const allNodes = Array.from(this.nodes.entries());
            const sortedByTime = allNodes.sort((a, b) => b[1].timestamp - a[1].timestamp);

            for (const [hash] of sortedByTime) {
                if (nodesToKeep.size >= maxNodes) {
                    break;
                }
                nodesToKeep.add(hash);
            }
        }

        // Remove nodes that are not in the keep set
        for (const hash of this.nodes.keys()) {
            if (!nodesToKeep.has(hash)) {
                this.nodes.delete(hash);
            }
        }

        // Clean up references to deleted nodes
        for (const node of this.nodes.values()) {
            node.children = node.children.filter(child => this.nodes.has(child));
        }
    }
}
