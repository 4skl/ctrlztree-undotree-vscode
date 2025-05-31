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
    let outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel("CtrlZTree");

    try {
        outputChannel.appendLine('CtrlZTree: Extension activating...');

        const historyTrees: Map<string, CtrlZTree> = new Map();
        const activeVisualizationPanels = new Map<string, vscode.WebviewPanel>();
        const panelToFullHashMap = new Map<vscode.WebviewPanel, Map<string, string>>();
        let isApplyingEdit = false; 

        outputChannel.appendLine('CtrlZTree: Initializing data structures.');

        // Function to send updated tree data to the webview
        function postUpdatesToWebview(panel: vscode.WebviewPanel, tree: CtrlZTree, documentUriString: string) {
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

            panelToFullHashMap.set(panel, currentFullHashMap); // Keep panel's hash map updated

            panel.webview.postMessage({
                command: 'updateTree',
                nodes: nodesArrayForVis,
                edges: edgesArrayForVis,
                headShortHash: currentHeadShortHash
            });
            outputChannel.appendLine(`CtrlZTree: Posted updates to webview for ${documentUriString}`);
        }
        
        function getOrCreateTree(document: vscode.TextDocument): CtrlZTree {
            const key = document.uri.toString();
            if (!historyTrees.has(key)) {
                outputChannel.appendLine(`CtrlZTree: Creating new tree for ${key}`);
                const tree = new CtrlZTree(document.getText());
                historyTrees.set(key, tree);
            }
            return historyTrees.get(key)!;
        }
        outputChannel.appendLine('CtrlZTree: getOrCreateTree function defined.');

        function getWebviewContent(initialNodes: any[], initialEdges: any[], currentHeadShortHash: string | null, cspSource: string, fileName: string): string {
            return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" 
                      content="default-src 'none'; 
                               script-src ${cspSource} 'unsafe-inline' https://unpkg.com; 
                               style-src ${cspSource} 'unsafe-inline' https://unpkg.com data:; 
                               font-src ${cspSource} https://unpkg.com data:; 
                               img-src ${cspSource} data: https:; 
                               connect-src ${cspSource};">
                <title>CtrlZTree: ${fileName}</title>
                <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
                <style>
                    #tree-visualization {
                        width: 100%;
                        height: 100vh; /* Full viewport height */
                        border: 1px solid lightgray;
                    }
                    /* Fallback: pointer cursor on node hover */
                    .vis-network:hover { cursor: pointer !important; }
                </style>
            </head>
            <body>
                <div id="tree-visualization"></div>
                <script>
                try {
                    console.log('CtrlZTree Webview: Script tag started. Initializing...'); // New very early log
                    const vscode = acquireVsCodeApi(); 
                    console.log('CtrlZTree Webview: acquireVsCodeApi called.');
                    let network = null;
                    let nodes = new vis.DataSet(${JSON.stringify(initialNodes)});
                    console.log('CtrlZTree Webview: Initial nodes DataSet created.');
                    let edges = new vis.DataSet(${JSON.stringify(initialEdges)});
                    console.log('CtrlZTree Webview: Initial edges DataSet created.');
                    let currentHeadNodeId = ${currentHeadShortHash ? "'" + currentHeadShortHash + "'" : null};
                    console.log('CtrlZTree Webview: Initial currentHeadNodeId:', currentHeadNodeId);
                    const container = document.getElementById('tree-visualization');
                    console.log('CtrlZTree Webview: Container element:', container ? 'found' : 'NOT FOUND');

                    function initializeOrUpdateNetwork(newNodesArray, newEdgesArray, headNodeId) {
                        console.log('CtrlZTree Webview: initializeOrUpdateNetwork called. Target Head ID:', headNodeId);
                        
                        nodes.clear();
                        nodes.add(newNodesArray);
                        edges.clear();
                        edges.add(newEdgesArray);
                        
                        currentHeadNodeId = headNodeId;

                        const allNodeIds = nodes.getIds();
                        console.log('CtrlZTree Webview: All node IDs in DataSet:', JSON.stringify(allNodeIds));
                        console.log('CtrlZTree Webview: Current head for coloring:', currentHeadNodeId);

                        const colorUpdates = allNodeIds.map(nodeId => {
                            const isHead = nodeId === currentHeadNodeId;
                            return {
                                id: nodeId,
                                color: isHead ? '#ff0000' : '#3333ff'
                            };
                        });

                        if (colorUpdates.length > 0) {
                            console.log('CtrlZTree Webview: Applying color updates. Head update (or first):', JSON.stringify(colorUpdates.find(u => u.color === '#ff0000') || colorUpdates[0]));
                            nodes.update(colorUpdates);
                        } else {
                            console.log('CtrlZTree Webview: No color updates to apply (nodeset might be empty).');
                        }
                        
                        if (!network) {
                            console.log('CtrlZTree Webview: Creating new vis.Network instance.');
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
                                },
                                nodes: {
                                    shape: 'box',
                                    margin: 10
                                }
                            };
                            network = new vis.Network(container, data, options);

                            network.on("click", function (params) {
                                if (params.nodes.length > 0) {
                                    const clickedNodeId = params.nodes[0];
                                    console.log('CtrlZTree Webview: Node clicked:', clickedNodeId);
                                    vscode.postMessage({
                                        command: 'navigateToNode',
                                        shortHash: clickedNodeId
                                    });
                                }
                            });

                            network.on("hoverNode", function (params) {
                                console.log('CtrlZTree Webview: hoverNode event. Node ID:', params.node);
                                if (network && network.canvas && network.canvas.body && network.canvas.body.container) {
                                    network.canvas.body.container.style.cursor = 'pointer';
                                    console.log('CtrlZTree Webview: Set cursor to pointer on network canvas container.');
                                } else {
                                    console.log('CtrlZTree Webview: Network canvas container not found for cursor change on hover.');
                                }
                            });

                            network.on("blurNode", function (params) {
                                console.log('CtrlZTree Webview: blurNode event. Node ID:', params.node);
                                if (network && network.canvas && network.canvas.body && network.canvas.body.container) {
                                    network.canvas.body.container.style.cursor = 'default';
                                    console.log('CtrlZTree Webview: Reset cursor to default on network canvas container.');
                                } else {
                                    console.log('CtrlZTree Webview: Network canvas container not found for cursor change on blur.');
                                }
                            });
                        } else {
                            console.log('CtrlZTree Webview: Network already exists. DataSets updated and colors reapplied.');
                        }
                    }

                    // Initial call
                    if (container) {
                        initializeOrUpdateNetwork(${JSON.stringify(initialNodes)}, ${JSON.stringify(initialEdges)}, currentHeadNodeId);
                    } else {
                        console.error('CtrlZTree Webview: Cannot initialize network, container not found.');
                    }

                    window.addEventListener('message', event => {
                        const message = event.data;
                        console.log('CtrlZTree Webview: Received message command:', message.command);
                        switch (message.command) {
                            case 'updateTree':
                                initializeOrUpdateNetwork(message.nodes, message.edges, message.headShortHash);
                                break;
                        }
                    });
                } catch (e) {
                    console.error('CtrlZTree Webview: CRITICAL ERROR IN SCRIPT TAG:', e.message, e.stack, e);
                    // Attempt to post the error back to the extension
                    // This might not work if vscode API itself failed or if postMessage isn't set up
                    if (typeof vscode !== 'undefined' && typeof vscode.postMessage === 'function') {
                        vscode.postMessage({ 
                            command: 'webviewError', 
                            error: { 
                                message: e.message, 
                                stack: e.stack ? e.stack.toString() : 'No stack available' 
                            }
                        });
                    }
                }
                </script>
            </body>
            </html>
            `;
        }

        // Fix: Only create a new panel if there is no existing panel for the document
        async function showVisualizationForDocument(documentToShow: vscode.TextDocument | undefined) {
            if (!documentToShow) {
                outputChannel.appendLine('CtrlZTree: showVisualizationForDocument called with no document.');
                return;
            }
            outputChannel.appendLine(`CtrlZTree: showVisualizationForDocument called for ${documentToShow.uri.toString()}`);
    
            const docUriString = documentToShow.uri.toString();
    
            // FIX: Only create a new panel if the existing panel is not disposed
            const existingPanel = activeVisualizationPanels.get(docUriString);
            // Always use the correct file name for the panel title
            let fileName = documentToShow.fileName;
            if (!fileName || fileName.trim() === '') {
                fileName = documentToShow.uri.path.split(/[\\/]/).pop() || 'Untitled';
            } else {
                fileName = fileName.split(/[\\/]/).pop() || fileName;
            }
            if (existingPanel && typeof existingPanel.reveal === 'function') {
                existingPanel.title = `CtrlZTree: ${fileName}`;
                const tree = getOrCreateTree(documentToShow);
                postUpdatesToWebview(existingPanel, tree, docUriString);
                outputChannel.appendLine(`CtrlZTree: Updating and revealing existing panel for ${docUriString}`);
                existingPanel.reveal(vscode.ViewColumn.Beside, false);
                return; // Do NOT create a new panel
            }
            
            outputChannel.appendLine(`CtrlZTree: Creating new visualization panel for ${docUriString}`);
            const tree = getOrCreateTree(documentToShow);
            
            // Use the file name in the panel title (handle untitled and edge cases)
            let fileNameForPanel = documentToShow.fileName;
            if (!fileNameForPanel || fileNameForPanel.trim() === '') {
                // Try to get a name for untitled files
                fileNameForPanel = documentToShow.uri.path.split(/[\\/]/).pop() || 'Untitled';
            } else {
                fileNameForPanel = fileNameForPanel.split(/[\\/]/).pop() || fileNameForPanel;
            }
            const panel = vscode.window.createWebviewPanel(
                'ctrlzTreeVisualization',
                `CtrlZTree: ${fileNameForPanel}`,
                vscode.ViewColumn.Beside,
                { 
                    enableScripts: true,
                    localResourceRoots: [],
                    retainContextWhenHidden: true
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
            
            panel.webview.html = getWebviewContent(nodesArrayForVis, edgesArrayForVis, currentHeadShortHash, panel.webview.cspSource, fileNameForPanel);
            outputChannel.appendLine(`CtrlZTree: New panel created and HTML set for ${docUriString}`);
    
            panel.onDidChangeViewState(
                e => {
                    if (e.webviewPanel.visible) {
                        outputChannel.appendLine(`CtrlZTree: Panel for ${docUriString} became visible. Posting updates.`);
                        const currentTree = historyTrees.get(docUriString);
                        const currentPanel = activeVisualizationPanels.get(docUriString);
                        if (currentTree && currentPanel && currentPanel === panel) { 
                            postUpdatesToWebview(panel, currentTree, docUriString);
                        }
                    }
                },
                null,
                context.subscriptions
            );
    
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'navigateToNode':
                            const activeEditor = vscode.window.activeTextEditor;
                            if (!activeEditor || activeEditor.document.uri.toString() !== docUriString) {
                                vscode.window.showErrorMessage('CtrlZTree: Target document for navigation is not active or has changed.');
                                outputChannel.appendLine(`CtrlZTree: Navigation failed. Target ${docUriString}, Active: ${activeEditor?.document.uri.toString()}`);
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
                                            activeEditor.document.uri,
                                            new vscode.Range(0, 0, activeEditor.document.lineCount, 0),
                                            content
                                        );
                                        await vscode.workspace.applyEdit(edit);
                                    } catch (e: any) {
                                        outputChannel.appendLine(`CtrlZTree: Error applying edit from webview: ${e.message} Stack: ${e.stack}`);
                                        vscode.window.showErrorMessage(`CtrlZTree navigation error: ${e.message}`);
                                    } finally {
                                        isApplyingEdit = false;
                                    }
                                    // Always update the visualization after navigation
                                    const navPanel = activeVisualizationPanels.get(docUriString);
                                    if (navPanel) {
                                        postUpdatesToWebview(navPanel, targetTree, docUriString);
                                    }
                                } else {
                                    vscode.window.showWarningMessage(`CtrlZTree: Could not find node for hash ${shortHash}`);
                                }
                            } else {
                                vscode.window.showErrorMessage('CtrlZTree: Could not navigate. Tree not available or hash not found.');
                            }
                            return;
                        case 'webviewError':
                            outputChannel.appendLine(`CtrlZTree: Webview CRITICAL ERROR: ${message.error.message} Stack: ${message.error.stack}`);
                            vscode.window.showErrorMessage(`CtrlZTree Webview Critical Error: ${message.error.message}. Check CtrlZTree output channel.`);
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );
    
            panel.onDidDispose(
                () => {
                    outputChannel.appendLine(`CtrlZTree: Panel for ${docUriString} disposed.`);
                    activeVisualizationPanels.delete(docUriString);
                    panelToFullHashMap.delete(panel);
                },
                null,
                context.subscriptions
            );
        }

        // Fix: Always update the panel's webview on file change, even if the panel is not visible
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async event => {
            if (isApplyingEdit) { 
                outputChannel.appendLine('CtrlZTree: onDidChangeTextDocument - skipping due to isApplyingEdit.');
                return; 
            } 
            
            if (event.document.uri.scheme === 'file' || event.document.uri.scheme === 'untitled') {
                try {
                    const tree = getOrCreateTree(event.document);
                    tree.set(event.document.getText());
                    outputChannel.appendLine('CtrlZTree: Document changed and processed.');
                    const docUriString = event.document.uri.toString();
                    const panel = activeVisualizationPanels.get(docUriString);
                    if (panel) {
                        postUpdatesToWebview(panel, tree, docUriString);
                        outputChannel.appendLine(`CtrlZTree: Panel for ${docUriString} updated after file change.`);
                    } else {
                        outputChannel.appendLine(`CtrlZTree: No panel open for ${docUriString} on file change.`);
                    }
                } catch (e: any) {
                    outputChannel.appendLine(`CtrlZTree: Error in onDidChangeTextDocument: ${e.message} Stack: ${e.stack}`);
                    vscode.window.showErrorMessage(`CtrlZTree onDidChangeTextDocument error: ${e.message}`);
                }
            }
        });
        outputChannel.appendLine('CtrlZTree: onDidChangeTextDocument subscribed.');
        
        outputChannel.appendLine('CtrlZTree: Registering undo command...');
        const undoCommand = vscode.commands.registerCommand('ctrlztree.undo', async () => {
            outputChannel.appendLine('CtrlZTree: undo command invoked.');
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
                } catch (e: any) {
                    outputChannel.appendLine(`CtrlZTree: Error applying undo: ${e.message} Stack: ${e.stack}`);
                    vscode.window.showErrorMessage('Error applying undo: ' + e.message);
                } finally {
                    isApplyingEdit = false;
                }
                // Always update the visualization after undo
                const panel = activeVisualizationPanels.get(document.uri.toString());
                if (panel) {
                    postUpdatesToWebview(panel, tree, document.uri.toString());
                }
                outputChannel.appendLine(`CtrlZTree: Applied undo. New head: ${newHead}`);
            } else {
                outputChannel.appendLine('CtrlZTree: No more undo history.');
                vscode.window.showInformationMessage('No more undo history');
            }
        });
        outputChannel.appendLine('CtrlZTree: undo command registered.');

        outputChannel.appendLine('CtrlZTree: Registering redo command...');
        const redoCommand = vscode.commands.registerCommand('ctrlztree.redo', async () => {
            outputChannel.appendLine('CtrlZTree: redo command invoked.');
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            
            const document = editor.document;
            const tree = getOrCreateTree(document);
            
            const result = tree.y();
            
            if (typeof result === 'string') { // Single new head
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
                } catch (e: any) {
                    outputChannel.appendLine(`CtrlZTree: Error applying redo (single head): ${e.message} Stack: ${e.stack}`);
                    vscode.window.showErrorMessage('Error applying redo: ' + e.message);
                } finally {
                    isApplyingEdit = false;
                }
                // Always update the visualization after redo
                const panel = activeVisualizationPanels.get(document.uri.toString());
                if (panel) {
                    postUpdatesToWebview(panel, tree, document.uri.toString());
                }
                outputChannel.appendLine(`CtrlZTree: Applied redo. New head: ${result}`);
            } else if (result.length > 0) { // Ambiguous redo, result is an array of possible next states (hashes)
                outputChannel.appendLine(`CtrlZTree: Ambiguous redo. Options: ${result.join(', ')}`);
                const items = result.map(hash => {
                    const nodeContent = tree.getContent(hash); // Get content for specific hash
                    const preview = nodeContent.substring(0, 50).replace(/\\n/g, '⏎') + (nodeContent.length > 50 ? '...' : '');
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
                        const content = tree.getContent(); // Content of newly selected head
                        const edit = new vscode.WorkspaceEdit();
                        edit.replace(
                            document.uri,
                            new vscode.Range(0, 0, document.lineCount, 0),
                            content
                        );
                        await vscode.workspace.applyEdit(edit);
                    } catch (e: any) {
                        outputChannel.appendLine(`CtrlZTree: Error applying redo edit (branch selection): ${e.message} Stack: ${e.stack}`);
                        vscode.window.showErrorMessage('Error applying redo: ' + e.message);
                    } finally {
                        isApplyingEdit = false;
                    }
                    // Always update the visualization after branch selection
                    const panel = activeVisualizationPanels.get(document.uri.toString());
                    if (panel) {
                        postUpdatesToWebview(panel, tree, document.uri.toString());
                    }
                }
            } else {
                outputChannel.appendLine('CtrlZTree: No more redo history.');
                vscode.window.showInformationMessage('No more redo history');
            }
        });
        outputChannel.appendLine('CtrlZTree: redo command registered.');

        outputChannel.appendLine('CtrlZTree: Registering visualize command...');
        const visualizeCommand = vscode.commands.registerCommand('ctrlztree.visualize', async () => {
            outputChannel.appendLine('CtrlZTree: visualize command invoked.');
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showInformationMessage('No active editor');
                return;
            }
            await showVisualizationForDocument(editor.document);
        });
        outputChannel.appendLine('CtrlZTree: visualize command registered.');

        context.subscriptions.push(changeDocumentSubscription, undoCommand, redoCommand, visualizeCommand);
        outputChannel.appendLine('CtrlZTree: All commands and subscriptions pushed.');

        outputChannel.appendLine('CtrlZTree: Extension activation completed successfully.');

    } catch (e: any) {
        if (outputChannel) {
            outputChannel.appendLine(`CtrlZTree: CRITICAL ERROR during activation: ${e.message} Stack: ${e.stack}`);
        } else {
            // Fallback if outputChannel itself failed to initialize
            console.error(`CtrlZTree: CRITICAL ERROR during activation (outputChannel not available): ${e.message} Stack: ${e.stack}`);
        }
        vscode.window.showErrorMessage('CtrlZTree failed to activate: ' + e.message);
    }
}

export function deactivate() {}
