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
    private readonly trueEmptyRootContent: string = ""; // Ultimate root is empty

    constructor(initialDocumentContent: string) { // Content of the document when tree is first made
        this.nodes = new Map<string, TreeNode>();
        
        const trueEmptyRootHash = this.calculateHash(this.trueEmptyRootContent);
        const trueEmptyRootNode: TreeNode = {
            hash: trueEmptyRootHash,
            parent: null,
            children: [],
            diff: null
        };
        this.nodes.set(trueEmptyRootHash, trueEmptyRootNode);
        this.head = trueEmptyRootHash; // Start at the true empty root

        // If the document wasn't initially empty, set its content as the first state.
        if (initialDocumentContent !== this.trueEmptyRootContent) {
            this.set(initialDocumentContent);
        }
    }

    private calculateHash(content: string): string {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    // Get the current content by applying all diffs from root to head
    private reconstructContent(hash: string): string {
        const path = this.getPathToRoot(hash);
        let content = this.trueEmptyRootContent; // Start from the empty root
        
        // Apply diffs in reverse order (from child of empty root to target)
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
        const newHash = this.calculateHash(content);

        if (this.nodes.has(newHash)) {
            this.head = newHash;
            return newHash;
        }

        const currentContent = this.head ? this.reconstructContent(this.head) : this.trueEmptyRootContent;
        
        const diffOps = generateDiff(currentContent, content);
        const serializedDiff = serializeDiff(diffOps);
        
        // Create new node
        const node: TreeNode = {
            hash: newHash,
            parent: this.head,
            children: [],
            diff: serializedDiff
        };

        // If there's a parent, add this node as child
        if (this.head) {
            const parent = this.nodes.get(this.head)!;
            parent.children.push(newHash);
        }

        this.nodes.set(newHash, node);
        this.head = newHash;
        return newHash;
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
            return this.trueEmptyRootContent; // Fallback to empty content
        }
        return this.reconstructContent(targetHash);
    }
    
    // Get all nodes for visualization
    getAllNodes(): Map<string, TreeNode> {
        return new Map(this.nodes);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('CtrlZTree: Activation sequence started.');

    try {
        const historyTrees: Map<string, CtrlZTree> = new Map();
        const activeVisualizationPanels: Map<string, vscode.WebviewPanel> = new Map();
        const panelToFullHashMap: Map<vscode.WebviewPanel, Map<string, string>> = new Map();
        let isApplyingEdit = false;
        console.log('CtrlZTree: Initial variables declared.');

        // Function to send updated tree data to the webview
        function postUpdatesToWebview(documentUri: vscode.Uri) {
            const docUriString = documentUri.toString();
            const panel = activeVisualizationPanels.get(docUriString);
            const tree = historyTrees.get(docUriString);

            if (panel && panel.visible && tree) {
                const nodes = tree.getAllNodes();
                const nodesArrayForVis: any[] = [];
                const edgesArrayForVis: any[] = [];
                const currentFullHashMap = new Map<string, string>();
                const currentHeadFullHash = tree.getHead();
                let currentHeadShortHash: string | null = null;

                if (currentHeadFullHash) {
                    currentHeadShortHash = currentHeadFullHash.substring(0, 8);
                }

                nodes.forEach((node, fullHash) => {
                    const shortHash = fullHash.substring(0, 8);
                    currentFullHashMap.set(shortHash, fullHash);
                    nodesArrayForVis.push({
                        id: shortHash,
                        label: shortHash,
                        title: `Full Hash: ${fullHash}`
                    });
                    if (node.parent) {
                        edgesArrayForVis.push({
                            from: node.parent.substring(0, 8),
                            to: shortHash,
                        });
                    }
                });

                panelToFullHashMap.set(panel, currentFullHashMap);

                panel.webview.postMessage({
                    command: 'updateTree',
                    nodes: nodesArrayForVis,
                    edges: edgesArrayForVis,
                    headShortHash: currentHeadShortHash
                });
                console.log(`CtrlZTree: Posted updates to webview for ${docUriString}`);
            } else {
                console.log(`CtrlZTree: No active/visible panel or tree for ${docUriString} to post updates.`);
            }
        }
        
        function getOrCreateTree(document: vscode.TextDocument): CtrlZTree {
            const key = document.uri.toString();
            if (!historyTrees.has(key)) {
                console.log(`CtrlZTree: Creating new tree for ${key}`);
                const tree = new CtrlZTree(document.getText());
                historyTrees.set(key, tree);
            }
            return historyTrees.get(key)!;
        }
        console.log('CtrlZTree: getOrCreateTree function defined.');

        function getWebviewContent(initialNodes: any[], initialEdges: any[], currentHeadShortHash: string | null): string {
            return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-UTF-8">
                <title>CtrlZTree Visualization</title>
                <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
                <style>
                    #tree-visualization {
                        width: 100%;
                        height: 100vh; /* Full viewport height */
                        border: 1px solid lightgray;
                    }
                </style>
            </head>
            <body>
                <div id="tree-visualization"></div>
                <script>
                    const vscode = acquireVsCodeApi(); 
                    let network = null;
                    let nodes = new vis.DataSet(${JSON.stringify(initialNodes)});
                    let edges = new vis.DataSet(${JSON.stringify(initialEdges)});
                    let currentHeadNodeId = ${currentHeadShortHash ? "'" + currentHeadShortHash + "'" : null};

                    function initializeOrUpdateNetwork(newNodesArray, newEdgesArray, headNodeId) {
                        if (nodes && edges) {
                            nodes.clear();
                            edges.clear();
                            nodes.add(newNodesArray);
                            edges.add(newEdgesArray);
                        } else {
                            nodes = new vis.DataSet(newNodesArray);
                            edges = new vis.DataSet(newEdgesArray);
                        }
                        currentHeadNodeId = headNodeId;

                        const allNodeIds = nodes.getIds();
                        const updates = allNodeIds.map(nodeId => ({
                            id: nodeId,
                            color: nodeId === currentHeadNodeId ? '#ff0000' : '#3333ff'
                        }));
                        if (updates.length > 0) {
                            nodes.update(updates);
                        }
                        
                        if (!network) {
                            const container = document.getElementById('tree-visualization');
                            const data = {
                                nodes: nodes,
                                edges: edges
                            };
                            const options = {
                                layout: {
                                    hierarchical: {
                                        direction: 'UD',
                                        sortMethod: 'directed',
                                        levelSeparation: 100,
                                        nodeSpacing: 100
                                    }
                                },
                                interaction: { 
                                    tooltipDelay: 200,
                                    hover: true 
                                }
                            };
                            network = new vis.Network(container, data, options);

                            network.on("click", function (params) {
                                if (params.nodes.length > 0) {
                                    const clickedNodeId = params.nodes[0];
                                    vscode.postMessage({
                                        command: 'navigateToNode',
                                        shortHash: clickedNodeId
                                    });
                                }
                            });
                        }
                    }

                    initializeOrUpdateNetwork(${JSON.stringify(initialNodes)}, ${JSON.stringify(initialEdges)}, currentHeadNodeId);

                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'updateTree':
                                initializeOrUpdateNetwork(message.nodes, message.edges, message.headShortHash);
                                break;
                        }
                    });
                </script>
            </body>
            </html>
            `;
        }

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
            if (isApplyingEdit) { return; } 
            
            if (event.document.uri.scheme === 'file' || event.document.uri.scheme === 'untitled') {
                try {
                    const tree = getOrCreateTree(event.document);
                    tree.set(event.document.getText());
                    postUpdatesToWebview(event.document.uri); // Update webview
                    console.log('CtrlZTree: Document changed and processed.');
                } catch (e: any) {
                    console.error('CtrlZTree: Error in onDidChangeTextDocument:', e.message, e.stack);
                    vscode.window.showErrorMessage(`CtrlZTree onDidChangeTextDocument error: ${e.message}`);
                }
            }
        });
        console.log('CtrlZTree: onDidChangeTextDocument subscribed.');
        
        console.log('CtrlZTree: Registering undo command...');
        const undoCommand = vscode.commands.registerCommand('ctrlztree.undo', async () => {
            console.log('CtrlZTree: undo command invoked.');
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
                    postUpdatesToWebview(document.uri); // Update webview
                } catch (e: any) {
                    console.error('CtrlZTree: Error applying undo edit:', e.message, e.stack);
                    vscode.window.showErrorMessage(`CtrlZTree undo error: ${e.message}`);
                } finally {
                    isApplyingEdit = false;
                }
            } else {
                vscode.window.showInformationMessage('No more undo history');
            }
        });
        console.log('CtrlZTree: undo command registered.');

        console.log('CtrlZTree: Registering redo command...');
        const redoCommand = vscode.commands.registerCommand('ctrlztree.redo', async () => {
            console.log('CtrlZTree: redo command invoked.');
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            
            const document = editor.document;
            const tree = getOrCreateTree(document);
            
            const result = tree.y();
            
            if (typeof result === 'string') {
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
                    postUpdatesToWebview(document.uri); // Update webview
                } catch (e: any) {
                    console.error('CtrlZTree: Error applying redo edit (single child):', e.message, e.stack);
                    vscode.window.showErrorMessage(`CtrlZTree redo error: ${e.message}`);
                } finally {
                    isApplyingEdit = false;
                }
            } else if (result.length > 0) {
                const items = result.map(hash => {
                    const content = tree.getContent(hash);
                    const preview = content.substring(0, 50).replace(/\\n/g, '⏎') + (content.length > 50 ? '...' : '');
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
                        postUpdatesToWebview(document.uri); // Update webview
                    } catch (e: any) {
                        console.error('CtrlZTree: Error applying redo edit (branch selection):', e.message, e.stack);
                        vscode.window.showErrorMessage(`CtrlZTree redo error: ${e.message}`);
                    } finally {
                        isApplyingEdit = false;
                    }
                }
            } else {
                vscode.window.showInformationMessage('No more redo history');
            }
        });
        console.log('CtrlZTree: redo command registered.');

        console.log('CtrlZTree: Registering visualize command...');
        const visualizeCommand = vscode.commands.registerCommand('ctrlztree.visualize', async () => {
            console.log('CtrlZTree: visualize command invoked.');
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('No active editor');
                return;
            }
            
            const document = editor.document;
            const docUriString = document.uri.toString();

            if (activeVisualizationPanels.has(docUriString)) {
                const existingPanel = activeVisualizationPanels.get(docUriString)!;
                existingPanel.reveal(vscode.ViewColumn.Beside);
                postUpdatesToWebview(document.uri);
                console.log(`CtrlZTree: Revealed existing panel for ${docUriString}`);
                return;
            }
            
            const tree = getOrCreateTree(document);
            
            const panel = vscode.window.createWebviewPanel(
                'ctrlzTreeVisualization',
                `CtrlZTree: ${document.fileName.split(/[\\/]/).pop()}`, // Show only filename
                vscode.ViewColumn.Beside,
                { 
                    enableScripts: true,
                    localResourceRoots: [],
                    // retainContextWhenHidden: true // Consider if state is lost often
                }
            );
            activeVisualizationPanels.set(docUriString, panel);
            
            const nodes = tree.getAllNodes();
            const nodesArrayForVis: any[] = [];
            const edgesArrayForVis: any[] = [];
            const initialFullHashMap = new Map<string, string>();
            const currentHeadFullHash = tree.getHead();
            let currentHeadShortHash: string | null = null;

            if (currentHeadFullHash) {
                currentHeadShortHash = currentHeadFullHash.substring(0, 8);
            }

            nodes.forEach((node, fullHash) => {
                const shortHash = fullHash.substring(0, 8);
                initialFullHashMap.set(shortHash, fullHash);
                nodesArrayForVis.push({
                    id: shortHash, 
                    label: shortHash,
                    title: `Full Hash: ${fullHash}`,
                });
                
                if (node.parent) {
                    edgesArrayForVis.push({
                        from: node.parent.substring(0, 8),
                        to: shortHash,
                    });
                }
            });
            panelToFullHashMap.set(panel, initialFullHashMap);
            
            panel.webview.html = getWebviewContent(nodesArrayForVis, edgesArrayForVis, currentHeadShortHash);
            console.log(`CtrlZTree: Created new panel for ${docUriString}`);

            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'navigateToNode':
                            const activeEditorForNavigation = vscode.window.activeTextEditor;
                            if (!activeEditorForNavigation || activeEditorForNavigation.document.uri.toString() !== docUriString) {
                                vscode.window.showErrorMessage('CtrlZTree: Target document for navigation is not active or has changed.');
                                return;
                            }
                            const currentPanelHashMap = panelToFullHashMap.get(panel);
                            if (!currentPanelHashMap) {
                                 vscode.window.showErrorMessage('CtrlZTree: Internal error - hash map not found for this panel.');
                                 return;
                            }

                            const shortHash = message.shortHash;
                            const fullHash = currentPanelHashMap.get(shortHash);
                            const targetTree = historyTrees.get(docUriString);

                            if (fullHash && targetTree) {
                                const success = targetTree.setHead(fullHash);
                                if (success) {
                                    isApplyingEdit = true;
                                    try {
                                        const content = targetTree.getContent();
                                        const edit = new vscode.WorkspaceEdit();
                                        edit.replace(
                                            activeEditorForNavigation.document.uri,
                                            new vscode.Range(0, 0, activeEditorForNavigation.document.lineCount, 0),
                                            content
                                        );
                                        await vscode.workspace.applyEdit(edit);
                                        postUpdatesToWebview(activeEditorForNavigation.document.uri);
                                    } catch (e: any) {
                                        console.error('CtrlZTree: Error applying edit from webview:', e.message, e.stack);
                                        vscode.window.showErrorMessage(`CtrlZTree navigation error: ${e.message}`);
                                    } finally {
                                        isApplyingEdit = false;
                                    }
                                } else {
                                    vscode.window.showWarningMessage(`CtrlZTree: Could not find node for hash ${shortHash}`);
                                }
                            } else {
                                vscode.window.showErrorMessage('CtrlZTree: Could not navigate. Editor or tree not available, or hash not found.');
                            }
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );

            panel.onDidDispose(
                () => {
                    console.log(`CtrlZTree: Panel for ${docUriString} disposed.`);
                    activeVisualizationPanels.delete(docUriString);
                    panelToFullHashMap.delete(panel);
                },
                null,
                context.subscriptions
            );

        });
        console.log('CtrlZTree: visualize command registered.');

        const closeDocumentSubscription = vscode.workspace.onDidCloseTextDocument(document => {
            const docUriString = document.uri.toString();
            if (activeVisualizationPanels.has(docUriString)) {
                const panelToDispose = activeVisualizationPanels.get(docUriString)!;
                panelToDispose.dispose(); // This will trigger its onDidDispose handler for cleanup
                console.log(`CtrlZTree: Disposed panel for closed document ${docUriString}`);
            }
            // Optionally, clean up historyTrees if memory becomes a concern,
            // but be careful if you want to retain history for reopened files.
            // if (historyTrees.has(docUriString)) {
            //     historyTrees.delete(docUriString);
            //     console.log(`CtrlZTree: Removed tree for closed document ${docUriString}`);
            // }
        });
        console.log('CtrlZTree: onDidCloseTextDocument subscribed.');
        
        context.subscriptions.push(
            changeDocumentSubscription,
            undoCommand,
            redoCommand,
            visualizeCommand,
            closeDocumentSubscription
        );
        console.log('CtrlZTree: All commands registered and subscriptions pushed. Activation successful.');

    } catch (e: any) {
        console.error('CtrlZTree: CRITICAL ERROR during activation:', e.message, e.stack);
        vscode.window.showErrorMessage(`CtrlZTree failed to activate: ${e.message}. Check Debug Console.`);
    }
}

export function deactivate() {}
