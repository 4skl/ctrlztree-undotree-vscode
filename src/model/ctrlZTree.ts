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

/**
 * CtrlZTree class represents the history tree for a document
 */
export class CtrlZTree {
    private nodes: Map<string, TreeNode>;
    private head: string | null;
    private readonly trueEmptyRootContent: string = '';
    private readonly trueEmptyRootHash: string;
    private initialSnapshotHash?: string;

    /**
     * Create a new CtrlZTree instance
     * @param initialDocumentContent - The initial content of the document
     */
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

    /**
     * Calculate SHA-256 hash of content with optional salt
     * @param content - Content to hash
     * @param salt - Optional salt for hashing
     * @returns SHA-256 hash as hex string
     */
    private calculateHash(content: string, salt: string = ''): string {
        return crypto.createHash('sha256').update(content + salt).digest('hex');
    }

    /**
     * Reconstruct document content from a specific node
     * @param hash - Hash of the node to reconstruct from
     * @returns Reconstructed content
     */
    private reconstructContent(hash: string): string {
        const path = this.getPathToRoot(hash);
        let content = this.trueEmptyRootContent;

        for (let i = path.length - 1; i >= 0; i--) {
            const node = this.nodes.get(path[i])!;
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

    /**
     * Get path from a node to the root
     * @param hash - Hash of the node to start from
     * @returns Array of hashes from node to root
     */
    private getPathToRoot(hash: string): string[] {
        const path: string[] = [];
        let currentHash = hash;
        
        // Failsafe cycle detector to completely prevent RangeError crashes
        const visited = new Set<string>();

        while (currentHash) {
            if (visited.has(currentHash)) {
                console.error(`CtrlZTree: Cycle detected in tree at node ${currentHash}. Breaking loop.`);
                break;
            }
            visited.add(currentHash);

            path.push(currentHash);
            const node = this.nodes.get(currentHash);
            if (!node || node.parent === null) {
                break;
            }
            currentHash = node.parent;
        }

        return path;
    }

    /**
     * Set document content and create a new node in the tree
     * @param content - New document content
     * @param cursorPosition - Optional cursor position to store
     * @returns Hash of the new node
     */
    set(content: string, cursorPosition?: vscode.Position): string {
        const currentContent = this.head ? this.reconstructContent(this.head) : this.trueEmptyRootContent;

        if (currentContent === content) {
            if (cursorPosition && this.head) {
                const headNode = this.nodes.get(this.head);
                if (headNode) {
                    headNode.cursorPosition = cursorPosition;
                }
            }
            return this.head || this.trueEmptyRootHash;
        }

        let newHash = this.calculateHash(content);

        // Prevent Hash Map Overwriting (Cycle Prevention)
        if (this.nodes.has(newHash)) {
            const existingNode = this.nodes.get(newHash)!;
            if (existingNode.parent === this.head) {
                this.head = newHash;
                return newHash;
            }
            newHash = this.calculateHash(content, Date.now().toString() + Math.random().toString());
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

    /**
     * Undo operation - move to parent node
     * @returns Hash of the new head node, or null if no parent
     */
    z(): string | null {
        if (!this.head) {
            return null;
        }

        const currentNode = this.nodes.get(this.head)!;
        
        if (this.head === this.initialSnapshotHash) {
            return null;
        }
        
        if (currentNode.parent) {
            this.head = currentNode.parent;
            return this.head;
        }
        return null;
    }

    /**
     * Find the latest non-empty state in the tree
     * @returns Hash of the latest non-empty state, or null if not found
     */
    findLatestNonEmptyState(): string | null {
        if (!this.head) {return null;}

        const currentContent = this.getContent(this.head);
        if (currentContent.trim() !== '') {return this.head;}

        let latestNonEmptyHash: string | null = null;
        let latestTimestamp = 0;

        for (const [hash, node] of this.nodes) {
            if (hash === this.trueEmptyRootHash) {continue;}

            // Quick check: if the node has no diff or a non-null diff, it might be non-empty.
            // Only reconstruct content as a fallback when the diff is null (initial state).
            let isNonEmpty: boolean;
            if (node.diff === null) {
                // Initial snapshot node — check by comparing to the empty root's content
                isNonEmpty = hash !== this.trueEmptyRootHash;
            } else {
                // Heuristic: if the diff exists and is non-trivial, assume non-empty.
                // This avoids expensive reconstruction for most nodes.
                isNonEmpty = node.diff.length > 0;
            }

            if (isNonEmpty && node.timestamp > latestTimestamp) {
                latestNonEmptyHash = hash;
                latestTimestamp = node.timestamp;
            }
        }

        return latestNonEmptyHash;
    }

    /**
     * Undo to the latest non-empty state
     * @returns Hash of the new head node, or null if no change
     */
    zToLatestNonEmpty(): string | null {
        const latestNonEmpty = this.findLatestNonEmptyState();
        if (latestNonEmpty && latestNonEmpty !== this.head) {
            this.head = latestNonEmpty;
            return this.head;
        }
        return null;
    }

    /**
     * Redo operation - move to child node(s)
     * @returns Hash of single child node if only one child, or array of child hashes if multiple
     */
    y(): string | string[] {
        if (!this.head) {return [];}

        const currentNode = this.nodes.get(this.head)!;
        if (currentNode.children.length === 1) {
            return currentNode.children[0];
        }
        return currentNode.children;
    }

    /**
     * Get the current head node hash
     * @returns Hash of the current head node, or null if no head
     */
    getHead(): string | null {
        return this.head;
    }

    /**
     * Set the head node to a specific hash
     * @param hash - Hash to set as head
     * @returns True if successful, false otherwise
     */
    setHead(hash: string): boolean {
        if (this.nodes.has(hash)) {
            this.head = hash;
            return true;
        }
        return false;
    }

    /**
     * Get content for a specific node or current head
     * @param hash - Optional hash of node to get content for
     * @returns Content of the node
     */
    getContent(hash?: string): string {
        const targetHash = hash || this.head;
        if (!targetHash || !this.nodes.has(targetHash)) {
            return this.trueEmptyRootContent;
        }
        return this.reconstructContent(targetHash);
    }

    /**
     * Get cursor position for a specific node or current head
     * @param hash - Optional hash of node to get cursor position for
     * @returns Cursor position or undefined
     */
    getCursorPosition(hash?: string): vscode.Position | undefined {
        const targetHash = hash || this.head;
        if (!targetHash || !this.nodes.has(targetHash)) {
            return undefined;
        }
        return this.nodes.get(targetHash)!.cursorPosition;
    }

    /**
     * Get all nodes in the tree
     * @returns Map of all nodes
     */
    getAllNodes(): Map<string, TreeNode> {
        return new Map(this.nodes);
    }

    /**
     * Get the internal root hash
     * @returns Internal root hash
     */
    getInternalRootHash(): string {
        return this.trueEmptyRootHash;
    }

    /**
     * Get the initial snapshot hash
     * @returns Initial snapshot hash
     */
    public getInitialSnapshotHash(): string {
        return this.initialSnapshotHash ?? this.trueEmptyRootHash;
    }

    /**
     * Get the number of nodes in the tree
     * @returns Number of nodes
     */
    public getNodeCount(): number {
        return this.nodes.size;
    }

    /**
     * Prune the tracked documents to keep at most maxTrackedDocuments
     * @param maxTrackedDocuments - Maximum number of tracked documents to keep
     */
    public pruneToMaxTrackedDocuments(maxTrackedDocuments: number): void {
        // This method is intentionally left empty as the pruning of tracked documents
        // is handled in the extension.ts file in the getOrCreateTree function
        // This is a placeholder for future implementation
    }

    /**
     * Prune the tree to keep at most maxNodes
     * @param maxNodes - Maximum number of nodes to keep
     */
    public pruneToMaxNodes(maxNodes: number): void {
        if (maxNodes <= 0) {return;}
        if (this.nodes.size <= maxNodes) {return;}

        const nodesToKeep = new Set<string>();
        nodesToKeep.add(this.trueEmptyRootHash);

        // Keep the head and the newest part of its ancestry. This guarantees
        // that pruning never leaves the head without a valid parent chain.
        let currentHash = this.head;
        const headAncestry: string[] = [];
        while (currentHash) {
            headAncestry.unshift(currentHash);
            const node = this.nodes.get(currentHash);
            if (!node || node.parent === null) {break;}
            currentHash = node.parent;
        }

        for (let i = headAncestry.length - 1; i >= 0 && nodesToKeep.size < maxNodes; i--) {
            nodesToKeep.add(headAncestry[i]);
        }

        if (this.initialSnapshotHash && nodesToKeep.size < maxNodes) {
            nodesToKeep.add(this.initialSnapshotHash);
        }

        const sortedByTime = Array.from(this.nodes.entries())
            .sort((a, b) => b[1].timestamp - a[1].timestamp);
        for (const [hash] of sortedByTime) {
            if (nodesToKeep.size >= maxNodes) {break;}
            nodesToKeep.add(hash);
        }

        // Rebase kept nodes whose original parent was removed. Rebuilding the
        // diff is necessary; otherwise reconstruction would follow a dangling
        // parent or apply operations against the wrong content.
        for (const hash of nodesToKeep) {
            if (hash === this.trueEmptyRootHash) {continue;}
            const node = this.nodes.get(hash);
            if (!node) {continue;}

            if (node.parent && nodesToKeep.has(node.parent)) {
                continue;
            }

            let rebasedParent = node.parent;
            while (rebasedParent && !nodesToKeep.has(rebasedParent)) {
                rebasedParent = this.nodes.get(rebasedParent)?.parent ?? null;
            }
            if (!rebasedParent) {
                rebasedParent = nodesToKeep.has(this.trueEmptyRootHash)
                    ? this.trueEmptyRootHash
                    : null;
            }

            node.parent = rebasedParent;
            if (rebasedParent) {
                const parentContent = this.reconstructContent(rebasedParent);
                const nodeContent = this.reconstructContent(hash);
                node.diff = serializeDiff(generateDiff(parentContent, nodeContent));
            } else {
                node.diff = null;
            }
        }

        // Remove nodes not in nodesToKeep
        for (const hash of this.nodes.keys()) {
            if (!nodesToKeep.has(hash)) {
                this.nodes.delete(hash);
            }
        }

        // Clean up children references to ensure tree integrity
        for (const node of this.nodes.values()) {
            // Filter children to only include nodes that still exist
            node.children = node.children.filter(child => this.nodes.has(child));
        }
    }
}