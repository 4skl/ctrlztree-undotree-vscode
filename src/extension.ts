// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { generateDiff, applyDiff, serializeDiff, deserializeDiff } from './lcs';

interface TreeNode {
    hash: string;
    parent: string | null;
    children: string[];
    diff: string | null; // Serialized diff from parent to this node
}

class CtrlZTree {
    private nodes: Map<string, TreeNode>;
    private head: string | null;
    private rootContent: string; // Store root content to reconstruct any state

    constructor(initialContent: string) {
        this.nodes = new Map<string, TreeNode>();
        this.head = null;
        this.rootContent = initialContent;
        
        // Create the root node
        const rootHash = this.calculateHash(initialContent);
        const rootNode: TreeNode = {
            hash: rootHash,
            parent: null,
            children: [],
            diff: null
        };
        
        this.nodes.set(rootHash, rootNode);
        this.head = rootHash;
    }

    private calculateHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    // Get the current content by applying all diffs from root to head
    private reconstructContent(hash: string): string {
        const path = this.getPathToRoot(hash);
        let content = this.rootContent;
        
        // Apply diffs in reverse order (from root to target)
        for (let i = path.length - 2; i >= 0; i--) {
            const node = this.nodes.get(path[i])!;
            if (node.diff) {
                const diffOps = deserializeDiff(node.diff);
                content = applyDiff(content, diffOps);
            }
        }
        
        return content;
    }

    // Get an array of hashes representing the path from the given hash to the root
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

    // Set new content and compute diff
    set(content: string): string {
        const hash = this.calculateHash(content);
        
        // Check if node already exists
        if (this.nodes.has(hash)) {
            this.head = hash;
            return hash;
        }

        // Get current content to compute diff
        const currentContent = this.head ? this.reconstructContent(this.head) : '';
        
        // Create diff
        const diffOps = generateDiff(currentContent, content);
        const serializedDiff = serializeDiff(diffOps);
        
        // Create new node
        const node: TreeNode = {
            hash,
            parent: this.head,
            children: [],
            diff: serializedDiff
        };

        // If there's a parent, add this node as child
        if (this.head) {
            const parent = this.nodes.get(this.head)!;
            parent.children.push(hash);
        }

        this.nodes.set(hash, node);
        this.head = hash;
        return hash;
    }

    // Move head to parent node (undo)
    z(): string | null {
        if (!this.head) { return null; }
        
        const currentNode = this.nodes.get(this.head)!;
        if (currentNode.parent) {
            this.head = currentNode.parent;
            return this.head;
        }
        return null;
    }

    // Move head to child (redo) or return list of children
    y(): string | string[] {
        if (!this.head) { return []; }
        
        const currentNode = this.nodes.get(this.head)!;
        if (currentNode.children.length === 1) {
            this.head = currentNode.children[0];
            return this.head;
        }
        return currentNode.children;
    }

    // Get current head
    getHead(): string | null {
        return this.head;
    }

    // Set head to specific hash
    setHead(hash: string): boolean {
        if (this.nodes.has(hash)) {
            this.head = hash;
            return true;
        }
        return false;
    }

    // Get content at head or specific hash
    getContent(hash?: string): string {
        const targetHash = hash || this.head;
        if (!targetHash || !this.nodes.has(targetHash)) {
            return this.rootContent;
        }
        return this.reconstructContent(targetHash);
    }
    
    // Get all nodes for visualization
    getAllNodes(): Map<string, TreeNode> {
        return new Map(this.nodes);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('CtrlZTree extension is now active');

    const historyTrees: Map<string, CtrlZTree> = new Map();
    let isApplyingEdit = false; // Flag to prevent recording our own edits
    
    // Create tree for document if it doesn't exist
    function getOrCreateTree(document: vscode.TextDocument): CtrlZTree {
        const key = document.uri.toString();
        if (!historyTrees.has(key)) {
            const tree = new CtrlZTree(document.getText());
            historyTrees.set(key, tree);
        }
        return historyTrees.get(key)!;
    }

    // Listen to document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
        if (isApplyingEdit) { return; } // Skip if we're applying an edit ourselves
        
        if (event.document.uri.scheme === 'file') {
            const tree = getOrCreateTree(event.document);
            tree.set(event.document.getText());
        }
    });
    
    // Register commands
    const undoCommand = vscode.commands.registerCommand('ctrlztree.undo', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        
        const document = editor.document;
        const tree = getOrCreateTree(document);
        
        const newHead = tree.z();
        
        if (newHead) {
            isApplyingEdit = true;
            try {
                const content = tree.getContent();
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    content
                );
                await vscode.workspace.applyEdit(edit);
            } finally {
                isApplyingEdit = false;
            }
        } else {
            vscode.window.showInformationMessage('No more undo history');
        }
    });

    const redoCommand = vscode.commands.registerCommand('ctrlztree.redo', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        
        const document = editor.document;
        const tree = getOrCreateTree(document);
        
        const result = tree.y();
        
        if (typeof result === 'string') {
            // Single child, can directly move to it
            isApplyingEdit = true;
            try {
                const content = tree.getContent();
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                    document.uri,
                    new vscode.Range(0, 0, document.lineCount, 0),
                    content
                );
                await vscode.workspace.applyEdit(edit);
            } finally {
                isApplyingEdit = false;
            }
        } else if (result.length > 0) {
            // Multiple children, let user pick
            const items = result.map(hash => {
                const content = tree.getContent(hash);
                // Creating a preview of the content for the quick pick
                const preview = content.substring(0, 50).replace(/\n/g, '⏎') + (content.length > 50 ? '...' : '');
                return {
                    label: `Branch ${hash.substring(0, 8)}`,
                    description: preview,
                    hash
                };
            });
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select branch to restore'
            });
            
            if (selected) {
                tree.setHead(selected.hash);
                isApplyingEdit = true;
                try {
                    const content = tree.getContent();
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(0, 0, document.lineCount, 0),
                        content
                    );
                    await vscode.workspace.applyEdit(edit);
                } finally {
                    isApplyingEdit = false;
                }
            }
        } else {
            vscode.window.showInformationMessage('No more redo history');
        }
    });

    // Register command to visualize the history tree
    const visualizeCommand = vscode.commands.registerCommand('ctrlztree.visualize', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('No active editor');
            return;
        }
        
        const document = editor.document;
        const tree = getOrCreateTree(document);
        
        // Create a temporary HTML file to visualize the tree
        const panel = vscode.window.createWebviewPanel(
            'ctrlzTreeVisualization',
            'CtrlZTree Visualization',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
        );
        
        // Convert the tree to a format suitable for visualization
        const nodes = tree.getAllNodes();
        const nodesArray: any[] = [];
        const edgesArray: any[] = [];
        
        nodes.forEach((node, hash) => {
            nodesArray.push({
                id: hash.substring(0, 8),
                label: hash.substring(0, 8),
                color: hash === tree.getHead() ? '#ff0000' : '#3333ff',
            });
            
            if (node.parent) {
                edgesArray.push({
                    from: node.parent.substring(0, 8),
                    to: hash.substring(0, 8),
                });
            }
        });
        
        // Create HTML for visualization using vis.js
        panel.webview.html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>CtrlZTree Visualization</title>
            <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
            <style>
                #tree-visualization {
                    width: 100%;
                    height: 600px;
                    border: 1px solid lightgray;
                }
            </style>
        </head>
        <body>
            <div id="tree-visualization"></div>
            <script>
                const nodes = ${JSON.stringify(nodesArray)};
                const edges = ${JSON.stringify(edgesArray)};
                
                // Create a network
                const container = document.getElementById('tree-visualization');
                const data = {
                    nodes: new vis.DataSet(nodes),
                    edges: new vis.DataSet(edges)
                };
                const options = {
                    layout: {
                        hierarchical: {
                            direction: 'UD',
                            sortMethod: 'directed',
                            levelSeparation: 150,
                            nodeSpacing: 100
                        }
                    }
                };
                const network = new vis.Network(container, data, options);
            </script>
        </body>
        </html>
        `;
    });
    
    context.subscriptions.push(
        changeDocumentSubscription,
        undoCommand,
        redoCommand,
        visualizeCommand
    );
}

export function deactivate() {}
