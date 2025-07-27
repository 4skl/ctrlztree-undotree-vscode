// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { generateDiff, applyDiff, serializeDiff, deserializeDiff, generateDiffSummary } from './lcs';

interface TreeNode {
    hash: string;
    parent: string | null;
    children: string[];
    diff: string | null; // Serialized diff from parent to this node
    timestamp: number; // Unix timestamp when this node was created
    cursorPosition?: vscode.Position; // Cursor position at this state
}

class CtrlZTree {
    private nodes: Map<string, TreeNode>;
    private head: string | null;
    private readonly trueEmptyRootContent: string = ""; // Ultimate root is empty

    constructor(initialDocumentContent: string) { // Content of the document when tree is first made
        this.nodes = new Map<string, TreeNode>();
        
        const trueEmptyRootHash = this.calculateHash(this.trueEmptyRootContent);        const trueEmptyRootNode: TreeNode = {
            hash: trueEmptyRootHash,
            parent: null,
            children: [],
            diff: null,
            timestamp: Date.now()
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
    set(content: string, cursorPosition?: vscode.Position): string {
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
            diff: serializedDiff,
            timestamp: Date.now(),
            cursorPosition: cursorPosition
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

    // Find the latest non-empty state from current position
    findLatestNonEmptyState(): string | null {
        if (!this.head) { return null; }
        
        // Check if current state is non-empty
        const currentContent = this.getContent(this.head);
        if (currentContent.trim() !== '') {
            return this.head; // Current state is already non-empty
        }
        
        // Search through all nodes to find the most recent non-empty one
        let latestNonEmptyHash: string | null = null;
        let latestTimestamp = 0;
        
        for (const [hash, node] of this.nodes) {
            // Skip the empty root
            if (hash === this.calculateHash(this.trueEmptyRootContent)) {
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

    // Special undo for empty files - goes to latest non-empty state
    zToLatestNonEmpty(): string | null {
        const latestNonEmpty = this.findLatestNonEmptyState();
        if (latestNonEmpty && latestNonEmpty !== this.head) {
            this.head = latestNonEmpty;
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
    
    // Get cursor position for head or specific hash
    getCursorPosition(hash?: string): vscode.Position | undefined {
        const targetHash = hash || this.head;
        if (!targetHash || !this.nodes.has(targetHash)) {
            return undefined;
        }
        return this.nodes.get(targetHash)!.cursorPosition;
    }
    
    // Get all nodes for visualization
    getAllNodes(): Map<string, TreeNode> {
        return new Map(this.nodes);
    }
}

// Module-level variables for cleanup
let documentChangeTimeouts: Map<string, NodeJS.Timeout> = new Map();
let pendingChanges: Map<string, string> = new Map();
let lastChangeTime: Map<string, number> = new Map();
let lastCursorPosition: Map<string, vscode.Position> = new Map();
let lastChangeType: Map<string, 'typing' | 'deletion' | 'other'> = new Map();

export function activate(context: vscode.ExtensionContext) {
    let outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel("CtrlZTree");

    try {
        outputChannel.appendLine('CtrlZTree: Extension activating...');

        const historyTrees: Map<string, CtrlZTree> = new Map();
        const activeVisualizationPanels = new Map<string, vscode.WebviewPanel>();
        const panelToFullHashMap = new Map<vscode.WebviewPanel, Map<string, string>>();
        let isApplyingEdit = false; 
        const processingDocuments = new Set<string>(); // Track documents currently being processed 
        
        const ACTION_TIMEOUT = 500; // Shorter timeout for action boundaries
        const PAUSE_THRESHOLD = 1500; // If user pauses longer than this, create new action
        
        // Helper function to determine if changes should be grouped
        function shouldGroupWithPreviousChange(
            docUriString: string, 
            currentText: string, 
            currentPosition: vscode.Position,
            changeType: 'typing' | 'deletion' | 'other'
        ): boolean {
            const lastTime = lastChangeTime.get(docUriString);
            const lastPos = lastCursorPosition.get(docUriString);
            const lastType = lastChangeType.get(docUriString);
            const now = Date.now();
            
            // If no previous change, don't group
            if (!lastTime || !lastPos || !lastType) {
                return false;
            }
            
            // If too much time has passed, don't group
            if (now - lastTime > PAUSE_THRESHOLD) {
                return false;
            }
            
            // If change type switched (typing to deletion or vice versa), don't group
            // Don't allow grouping 'other' with anything to be more conservative
            if (changeType !== lastType) {
                return false;
            }
            
            // More sophisticated cursor position analysis
            const lineDiff = Math.abs(currentPosition.line - lastPos.line);
            const charDiff = Math.abs(currentPosition.character - lastPos.character);
            
            // Don't group if:
            // 1. Different lines with more than 1 line difference
            // 2. Same line but cursor jumped more than reasonable typing distance
            // 3. Multi-line change with large character jumps
            if (lineDiff > 1) {
                return false; // More than 1 line apart
            }
            
            if (lineDiff === 0 && charDiff > 20) {
                return false; // Same line but too far apart
            }
            
            if (lineDiff === 1 && charDiff > 10) {
                return false; // Adjacent lines but big character jump
            }
            
            return true;
        }
        
        // Helper function to detect change type
        function detectChangeType(oldContent: string, newContent: string): 'typing' | 'deletion' | 'other' {
            const lengthDiff = newContent.length - oldContent.length;
            
            if (lengthDiff > 0) {
                return 'typing';
            } else if (lengthDiff < 0) {
                return 'deletion';
            } else {
                // Same length could be replacement - check if content actually changed
                return oldContent === newContent ? 'other' : 'typing'; // Treat replacements as typing
            }
        } 

        // Helper function to format timestamp as "time since now"
        function formatTimeAgo(timestamp: number): string {
            const now = Date.now();
            const diff = now - timestamp;
            const seconds = Math.floor(diff / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);
            
            if (days > 0) {
                return `${days} day${days > 1 ? 's' : ''} ago`;
            } else if (hours > 0) {
                return `${hours} hour${hours > 1 ? 's' : ''} ago`;
            } else if (minutes > 0) {
                return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
            } else if (seconds > 5) {
                return `${seconds} seconds ago`;
            } else {
                return 'Just now';
            }
        }        outputChannel.appendLine('CtrlZTree: Initializing data structures.');

        // Unified function to format any text content for node display
        function formatTextForNodeDisplay(text: string): string {
            if (!text || text.trim() === '') {
                return "Empty content";
            }
            
            // Clean the text: remove excessive whitespace, normalize line breaks
            const cleanText = text.replace(/\s+/g, ' ').trim();
            
            // Apply middle ellipsis format if text is too long
            if (cleanText.length > 80) {
                // Show first 37 chars + newline + ... + newline + last 37 chars
                return cleanText.substring(0, 37) + '\n...\n' + 
                       cleanText.substring(cleanText.length - 37);
            }
            
            return cleanText;
        }

        // Helper function to extract just the added text for showing in tooltip after commit ID
        function getAddedTextPreview(node: TreeNode, tree: CtrlZTree): string {
            if (!node.diff) {
                return "Initial commit";
            }
            
            try {
                const parentHash = node.parent;
                if (!parentHash) {
                    // For root node, show content
                    const currentContent = tree.getContent(node.hash);
                    return formatTextForNodeDisplay(currentContent);
                }
                
                const parentContent = tree.getContent(parentHash);
                const currentContent = tree.getContent(node.hash);
                
                // Use generateDiffSummary which now has unified formatting
                return generateDiffSummary(parentContent, currentContent);
                
            } catch {
                return "Parse error";
            }
        }

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
            }            nodes.forEach((node, fullHash) => {
                const shortHash = fullHash.substring(0, 8);
                currentFullHashMap.set(shortHash, fullHash);
                
                // Get added text preview for tooltip and label
                const addedTextPreview = getAddedTextPreview(node, tree);
                
                // Format timestamp as "time since now"
                const timeAgo = formatTimeAgo(node.timestamp);
                
                nodesArrayForVis.push({
                    id: shortHash,
                    label: `${timeAgo}\n${shortHash}\n${addedTextPreview}`,
                    title: `${timeAgo}\nHash: ${shortHash}\n${addedTextPreview}`
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

        function getWebviewContent(initialNodes: any[], initialEdges: any[], currentHeadShortHash: string | null, webview: vscode.Webview, fileName: string): string {
            // Get the local vis-network resource URI
            const visNetworkUri = webview.asWebviewUri(vscode.Uri.joinPath(
                context.extensionUri, 'resources', 'vis-network.min.js'
            ));
            
            return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" 
                      content="default-src 'none'; 
                               script-src ${webview.cspSource} 'unsafe-inline'; 
                               style-src ${webview.cspSource} 'unsafe-inline'; 
                               font-src ${webview.cspSource}; 
                               img-src ${webview.cspSource} data:;">
                <title>CtrlZTree ${fileName}</title>
                <script src="${visNetworkUri}"></script>
                <style>
                    :root {
                        /* VS Code theme-aware colors */
                        --vscode-background: var(--vscode-editor-background, #1e1e1e);
                        --vscode-foreground: var(--vscode-editor-foreground, #d4d4d4);
                        --vscode-accent: var(--vscode-focusBorder, #007acc);
                        --vscode-current: var(--vscode-list-activeSelectionBackground, #094771);
                        --vscode-border: var(--vscode-panel-border, #2d2d30);
                        --vscode-hover: var(--vscode-list-hoverBackground, #2a2d2e);
                    }
                    
                    body {
                        background-color: var(--vscode-background);
                        color: var(--vscode-foreground);
                        margin: 0;
                        padding: 0;
                        font-family: var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
                    }
                    
                    #toolbar {
                        position: fixed;
                        top: 10px;
                        right: 10px;
                        z-index: 1000;
                        background-color: var(--vscode-background);
                        border: 1px solid var(--vscode-border);
                        border-radius: 3px;
                        padding: 5px;
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                        display: flex;
                        gap: 5px;
                    }
                    
                    .toolbar-btn {
                        background-color: var(--vscode-button-background, var(--vscode-accent));
                        color: var(--vscode-button-foreground, var(--vscode-foreground));
                        border: none;
                        border-radius: 2px;
                        padding: 6px 12px;
                        cursor: pointer;
                        font-size: 12px;
                        font-family: inherit;
                        transition: background-color 0.2s;
                    }
                    
                    .toolbar-btn:hover {
                        background-color: var(--vscode-button-hoverBackground, var(--vscode-hover));
                    }
                    
                    .toolbar-btn:active {
                        background-color: var(--vscode-button-secondaryBackground, var(--vscode-current));
                    }
                    
                    #reset-btn {
                        background-color: var(--vscode-button-secondaryBackground, #5a5a5a);
                    }
                    
                    #reset-btn:hover {
                        background-color: var(--vscode-errorBackground, #d73a49);
                    }
                    
                    #tree-visualization {
                        width: 100%;
                        height: 100vh;
                        border: 1px solid var(--vscode-border);
                        background-color: var(--vscode-background);
                    }
                    
                    /* Ensure vis-network respects theme */
                    .vis-network canvas {
                        background-color: var(--vscode-background) !important;
                    }
                    
                    /* Fallback: pointer cursor on node hover */
                    .vis-network:hover { 
                        cursor: pointer !important; 
                    }
                </style>
            </head>
            <body>
                <div id="toolbar">
                    <button id="reload-btn" class="toolbar-btn" title="Reload Tree Visualization">🔄 Reload</button>
                    <button id="reset-btn" class="toolbar-btn" title="Reset Tree (Start Fresh from Current State)">🧽 Reset</button>
                </div>
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
                    
                    // Setup reload button
                    const reloadBtn = document.getElementById('reload-btn');
                    if (reloadBtn) {
                        reloadBtn.addEventListener('click', () => {
                            console.log('CtrlZTree Webview: Reload button clicked');
                            vscode.postMessage({
                                command: 'requestTreeReload'
                            });
                        });
                        console.log('CtrlZTree Webview: Reload button event listener added');
                    } else {
                        console.error('CtrlZTree Webview: Reload button not found');
                    }
                    
                    // Setup reset button
                    const resetBtn = document.getElementById('reset-btn');
                    if (resetBtn) {
                        resetBtn.addEventListener('click', () => {
                            console.log('CtrlZTree Webview: Reset button clicked');
                            vscode.postMessage({
                                command: 'requestTreeReset'
                            });
                        });
                        console.log('CtrlZTree Webview: Reset button event listener added');
                    } else {
                        console.error('CtrlZTree Webview: Reset button not found');
                    }

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

                        // Get CSS custom property values for theme-aware colors
                        const computedStyle = getComputedStyle(document.documentElement);
                        const accentColor = computedStyle.getPropertyValue('--vscode-accent').trim() || '#007acc';
                        const currentColor = computedStyle.getPropertyValue('--vscode-current').trim() || '#094771';
                        const foregroundColor = computedStyle.getPropertyValue('--vscode-foreground').trim() || '#d4d4d4';
                        const backgroundColor = computedStyle.getPropertyValue('--vscode-background').trim() || '#1e1e1e';

                        const colorUpdates = allNodeIds.map(nodeId => {
                            const isHead = nodeId === currentHeadNodeId;
                            return {
                                id: nodeId,
                                color: {
                                    background: isHead ? currentColor : accentColor,
                                    border: foregroundColor,
                                    highlight: {
                                        background: isHead ? currentColor : accentColor,
                                        border: foregroundColor
                                    }
                                },
                                font: {
                                    color: foregroundColor,
                                    size: isHead ? 16 : 12, // Make current node text larger
                                    bold: isHead ? true : false // Make current node text bold
                                },
                                // Remove explicit level assignment to preserve tree structure
                                borderWidth: isHead ? 4 : 2, // Make current node border much thicker
                                shadow: isHead ? {enabled: true, color: currentColor, size: 8} : false // Add glow to current node
                            };
                        });

                        if (colorUpdates.length > 0) {
                            console.log('CtrlZTree Webview: Applying theme-aware color updates. Head update (or first):', JSON.stringify(colorUpdates.find(u => u.id === currentHeadNodeId) || colorUpdates[0]));
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
                            
                            // Get theme colors for network configuration
                            const computedStyle = getComputedStyle(document.documentElement);
                            const foregroundColor = computedStyle.getPropertyValue('--vscode-foreground').trim() || '#d4d4d4';
                            const backgroundColor = computedStyle.getPropertyValue('--vscode-background').trim() || '#1e1e1e';
                            const borderColor = computedStyle.getPropertyValue('--vscode-border').trim() || '#2d2d30';
                            
                            const options = {
                                layout: {
                                    hierarchical: {
                                        direction: 'UD',
                                        sortMethod: 'directed',
                                        levelSeparation: 120, // Increased spacing between levels
                                        nodeSpacing: 150,     // Increased spacing between nodes
                                        shakeTowards: 'roots' // Prefer positioning towards root nodes
                                    }
                                },
                                interaction: { 
                                    tooltipDelay: 200,
                                    hover: true 
                                },
                                nodes: {
                                    shape: 'box',
                                    margin: 10,
                                    borderWidth: 2,
                                    font: {
                                        color: foregroundColor,
                                        size: 12,
                                        face: 'monospace'
                                    },
                                    chosen: {
                                        node: function(values, id, selected, hovering) {
                                            values.borderWidth = 3;
                                        }
                                    }
                                },
                                edges: {
                                    color: {
                                        color: foregroundColor,
                                        highlight: foregroundColor,
                                        hover: foregroundColor
                                    },
                                    width: 2,
                                    arrows: {
                                        to: {
                                            enabled: true,
                                            scaleFactor: 0.5
                                        }
                                    },
                                    smooth: {
                                        type: 'cubicBezier',
                                        forceDirection: 'vertical',
                                        roundness: 0.4
                                    }
                                },
                                physics: {
                                    enabled: false
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

                    // Listen for theme changes
                    window.addEventListener('message', event => {
                        const message = event.data;
                        console.log('CtrlZTree Webview: Received message command:', message.command);
                        switch (message.command) {
                            case 'updateTree':
                                initializeOrUpdateNetwork(message.nodes, message.edges, message.headShortHash);
                                break;
                            case 'updateTheme':
                                // Re-apply colors when theme changes
                                if (network) {
                                    const allNodeIds = nodes.getIds();
                                    const computedStyle = getComputedStyle(document.documentElement);
                                    const accentColor = computedStyle.getPropertyValue('--vscode-accent').trim() || '#007acc';
                                    const currentColor = computedStyle.getPropertyValue('--vscode-current').trim() || '#094771';
                                    const foregroundColor = computedStyle.getPropertyValue('--vscode-foreground').trim() || '#d4d4d4';
                                    
                                    const colorUpdates = allNodeIds.map(nodeId => {
                                        const isHead = nodeId === currentHeadNodeId;
                                        return {
                                            id: nodeId,
                                            color: {
                                                background: isHead ? currentColor : accentColor,
                                                border: foregroundColor,
                                                highlight: {
                                                    background: isHead ? currentColor : accentColor,
                                                    border: foregroundColor
                                                }
                                            },
                                            font: {
                                                color: foregroundColor,
                                                size: isHead ? 16 : 12, // Make current node text larger
                                                bold: isHead ? true : false // Make current node text bold
                                            },
                                            // Remove explicit level assignment to preserve tree structure
                                            borderWidth: isHead ? 4 : 2, // Make current node border much thicker
                                            shadow: isHead ? {enabled: true, color: currentColor, size: 8} : false // Add glow to current node
                                        };
                                    });
                                    
                                    if (colorUpdates.length > 0) {
                                        nodes.update(colorUpdates);
                                        console.log('CtrlZTree Webview: Updated colors for theme change');
                                    }
                                }
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
            let fileName = documentToShow.uri.path.split(/[\\/]/).pop() || 'Untitled';
            if (!fileName || fileName.trim() === '') {
                fileName = 'Untitled';
            }
            if (existingPanel && typeof existingPanel.reveal === 'function') {
                existingPanel.title = `CtrlZTree ${fileName}`;
                const tree = getOrCreateTree(documentToShow);
                postUpdatesToWebview(existingPanel, tree, docUriString);
                outputChannel.appendLine(`CtrlZTree: Updating and revealing existing panel for ${docUriString}`);
                existingPanel.reveal(vscode.ViewColumn.Beside, false);
                return; // Do NOT create a new panel
            }
            
            outputChannel.appendLine(`CtrlZTree: Creating new visualization panel for ${docUriString}`);
            const tree = getOrCreateTree(documentToShow);
            
            // Use the file name in the panel title (handle untitled and edge cases)
            let fileNameForPanel = documentToShow.uri.path.split(/[\\/]/).pop() || 'Untitled';
            if (!fileNameForPanel || fileNameForPanel.trim() === '') {
                fileNameForPanel = 'Untitled';
            }
            const panel = vscode.window.createWebviewPanel(
                'ctrlzTreeVisualization',
                `CtrlZTree ${fileNameForPanel}`,
                vscode.ViewColumn.Beside,
                { 
                    enableScripts: true,
                    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'resources')],
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
            }            nodes.forEach((node, fullHash) => {
                const shortHash = fullHash.substring(0, 8);
                initialFullHashMap.set(shortHash, fullHash);
                
                // Get added text preview for label and timestamp for tooltip
                const addedTextPreview = getAddedTextPreview(node, tree);
                const timeAgo = formatTimeAgo(node.timestamp);
                
                nodesArrayForVis.push({
                    id: shortHash,
                    label: `${timeAgo}\n${shortHash}\n${addedTextPreview}`,
                    title: `${timeAgo}\nHash: ${shortHash}\n${addedTextPreview}`
                });
                
                if (node.parent) {
                    edgesArrayForVis.push({
                        from: node.parent.substring(0, 8),
                        to: shortHash,
                    });
                }
            });
            panelToFullHashMap.set(panel, initialFullHashMap);
            
            panel.webview.html = getWebviewContent(nodesArrayForVis, edgesArrayForVis, currentHeadShortHash, panel.webview, fileNameForPanel);
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
                            // Check if the target document is open in ANY editor group (main editor or side panels)
                            const allVisibleEditors = vscode.window.visibleTextEditors;
                            let targetEditor = allVisibleEditors.find(editor => editor.document.uri.toString() === docUriString);
                            
                            if (!targetEditor) {
                                // Document is not currently visible in any editor group
                                // Check if it's at least open in memory
                                const targetDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === docUriString);
                                if (targetDocument) {
                                    // Document exists in memory but not visible, show it in the active column
                                    try {
                                        targetEditor = await vscode.window.showTextDocument(targetDocument, vscode.ViewColumn.Active);
                                        outputChannel.appendLine(`CtrlZTree: Successfully opened document ${docUriString} in active editor`);
                                    } catch (e: any) {
                                        outputChannel.appendLine(`CtrlZTree: Error opening document: ${e.message}`);
                                        vscode.window.showErrorMessage(`CtrlZTree: Could not open target document: ${e.message}`);
                                        return;
                                    }
                                } else {
                                    // Document is not open at all
                                    outputChannel.appendLine(`CtrlZTree: Target document ${docUriString} is not currently open in VS Code`);
                                    vscode.window.showInformationMessage('CtrlZTree: The target file is not currently open. Please open the file first, then try navigation again.');
                                    return;
                                }
                            } else {
                                // Document is visible in an editor group, make it active
                                try {
                                    targetEditor = await vscode.window.showTextDocument(targetEditor.document, {
                                        viewColumn: targetEditor.viewColumn,
                                        preserveFocus: false
                                    });
                                    outputChannel.appendLine(`CtrlZTree: Successfully switched to document ${docUriString} in editor group ${targetEditor.viewColumn}`);
                                } catch (e: any) {
                                    outputChannel.appendLine(`CtrlZTree: Error switching to visible editor: ${e.message}`);
                                    vscode.window.showErrorMessage(`CtrlZTree: Could not switch to target document: ${e.message}`);
                                    return;
                                }
                            }
                            
                            // Final validation
                            if (!targetEditor || targetEditor.document.uri.toString() !== docUriString) {
                                const errorMsg = `Could not activate target document for navigation. Expected: ${docUriString}, Got: ${targetEditor?.document.uri.toString() || 'none'}`;
                                outputChannel.appendLine(`CtrlZTree: ${errorMsg}`);
                                vscode.window.showErrorMessage(`CtrlZTree: ${errorMsg}`);
                                return;
                            }
                            
                            const currentPanelHashMap = panelToFullHashMap.get(panel);
                            if (!currentPanelHashMap) {
                                vscode.window.showErrorMessage('CtrlZTree: Internal error - hash map not found for this panel.');
                                outputChannel.appendLine('CtrlZTree: Hash map not found, attempting to recreate tree state...');
                                // Try to recreate the tree and hash map
                                const recreatedTree = getOrCreateTree(targetEditor.document);
                                if (recreatedTree) {
                                    postUpdatesToWebview(panel, recreatedTree, docUriString);
                                    vscode.window.showInformationMessage('CtrlZTree: Tree state restored. Please try navigation again.');
                                }
                                return;
                            }
                            const shortHash = message.shortHash;
                            const fullHash = currentPanelHashMap.get(shortHash);
                            const targetTree = historyTrees.get(docUriString);
                            
                            // Additional validation: ensure tree and hash are consistent
                            if (!targetTree) {
                                outputChannel.appendLine(`CtrlZTree: Tree not found for ${docUriString}, recreating...`);
                                const recreatedTree = getOrCreateTree(targetEditor.document);
                                postUpdatesToWebview(panel, recreatedTree, docUriString);
                                vscode.window.showInformationMessage('CtrlZTree: Tree recreated. Please try navigation again.');
                                return;
                            }
                            
                            if (!fullHash) {
                                outputChannel.appendLine(`CtrlZTree: Hash ${shortHash} not found in current panel map. Available hashes: ${Array.from(currentPanelHashMap.keys()).join(', ')}`);
                                vscode.window.showWarningMessage(`CtrlZTree: Node ${shortHash} not found. The tree may have been updated.`);
                                // Refresh the tree view
                                postUpdatesToWebview(panel, targetTree, docUriString);
                                return;
                            }
                            
                            if (fullHash && targetTree) {
                                const success = targetTree.setHead(fullHash);
                                if (success) {
                                    isApplyingEdit = true;
                                    try {
                                        const content = targetTree.getContent();
                                        const cursorPosition = targetTree.getCursorPosition();
                                        const edit = new vscode.WorkspaceEdit();
                                        
                                        // Ensure we have the correct document reference
                                        const activeDoc = targetEditor.document;
                                        if (activeDoc.uri.toString() !== docUriString) {
                                            throw new Error(`Document URI mismatch: expected ${docUriString}, got ${activeDoc.uri.toString()}`);
                                        }
                                        
                                        edit.replace(
                                            activeDoc.uri,
                                            new vscode.Range(0, 0, activeDoc.lineCount, 0),
                                            content
                                        );
                                        
                                        const applyResult = await vscode.workspace.applyEdit(edit);
                                        if (!applyResult) {
                                            throw new Error('WorkspaceEdit was not applied successfully');
                                        }
                                        
                                        // Restore cursor position if available
                                        if (cursorPosition) {
                                            // Ensure cursor position is within document bounds
                                            const maxLine = activeDoc.lineCount - 1;
                                            const adjustedLine = Math.min(cursorPosition.line, maxLine);
                                            const maxChar = activeDoc.lineAt(adjustedLine).text.length;
                                            const adjustedChar = Math.min(cursorPosition.character, maxChar);
                                            const adjustedPosition = new vscode.Position(adjustedLine, adjustedChar);
                                            
                                            targetEditor.selection = new vscode.Selection(adjustedPosition, adjustedPosition);
                                            targetEditor.revealRange(new vscode.Range(adjustedPosition, adjustedPosition));
                                        }
                                        
                                        outputChannel.appendLine(`CtrlZTree: Successfully navigated to node ${shortHash} (${fullHash.substring(0, 16)}...)`);
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
                        case 'requestTreeReload':
                            outputChannel.appendLine(`CtrlZTree: Tree reload requested for ${docUriString}`);
                            try {
                                // Get the current document
                                const targetDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === docUriString);
                                if (targetDocument) {
                                    const tree = getOrCreateTree(targetDocument);
                                    // Force refresh the webview with current tree state (timestamps will be recalculated)
                                    postUpdatesToWebview(panel, tree, docUriString);
                                    outputChannel.appendLine(`CtrlZTree: Tree reloaded successfully for ${docUriString}`);
                                } else {
                                    outputChannel.appendLine(`CtrlZTree: Could not find document for reload: ${docUriString}`);
                                    vscode.window.showWarningMessage('CtrlZTree: Could not reload - document not found');
                                }
                            } catch (e: any) {
                                outputChannel.appendLine(`CtrlZTree: Error during tree reload: ${e.message} Stack: ${e.stack}`);
                                vscode.window.showErrorMessage(`CtrlZTree reload error: ${e.message}`);
                            }
                            return;
                        case 'requestTreeReset':
                            outputChannel.appendLine(`CtrlZTree: Tree reset requested for ${docUriString}`);
                            try {
                                // Get the current document
                                const targetDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === docUriString);
                                if (targetDocument) {
                                    // Remove the existing tree from the history
                                    historyTrees.delete(docUriString);
                                    
                                    // Create a new tree with the current document content
                                    const newTree = new CtrlZTree(targetDocument.getText());
                                    historyTrees.set(docUriString, newTree);
                                    
                                    // Get cursor position from active editor if it matches this document
                                    let cursorPosition: vscode.Position | undefined;
                                    const editor = vscode.window.activeTextEditor;
                                    if (editor && editor.document.uri.toString() === docUriString) {
                                        cursorPosition = editor.selection.active;
                                    }
                                    
                                    // Set the current content as the initial state with cursor position
                                    if (cursorPosition) {
                                        newTree.set(targetDocument.getText(), cursorPosition);
                                    }
                                    
                                    // Clear tracking maps for this document to start fresh
                                    lastChangeTime.delete(docUriString);
                                    lastCursorPosition.delete(docUriString);
                                    lastChangeType.delete(docUriString);
                                    pendingChanges.delete(docUriString);
                                    const existingTimeout = documentChangeTimeouts.get(docUriString);
                                    if (existingTimeout) {
                                        clearTimeout(existingTimeout);
                                        documentChangeTimeouts.delete(docUriString);
                                    }
                                    
                                    // Update the webview with the new tree
                                    postUpdatesToWebview(panel, newTree, docUriString);
                                    outputChannel.appendLine(`CtrlZTree: Tree reset successfully for ${docUriString}`);
                                    vscode.window.showInformationMessage('CtrlZTree: Tree reset - starting fresh from current state');
                                } else {
                                    outputChannel.appendLine(`CtrlZTree: Could not find document for reset: ${docUriString}`);
                                    vscode.window.showWarningMessage('CtrlZTree: Could not reset - document not found');
                                }
                            } catch (e: any) {
                                outputChannel.appendLine(`CtrlZTree: Error during tree reset: ${e.message} Stack: ${e.stack}`);
                                vscode.window.showErrorMessage(`CtrlZTree reset error: ${e.message}`);
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

        // Helper function to process debounced document changes
        function processDocumentChange(document: vscode.TextDocument, content: string) {
            const docUriString = document.uri.toString();
            
            if (processingDocuments.has(docUriString)) {
                outputChannel.appendLine(`CtrlZTree: processDocumentChange - skipping ${docUriString} due to ongoing processing.`);
                return;
            }
            
            try {
                processingDocuments.add(docUriString);
                
                const tree = getOrCreateTree(document);
                const currentTreeContent = tree.getContent();
                
                // Only process if the document content actually differs from tree content
                if (content !== currentTreeContent) {
                    // Get cursor position from active editor if it matches this document
                    let cursorPosition: vscode.Position | undefined;
                    const editor = vscode.window.activeTextEditor;
                    if (editor && editor.document.uri.toString() === docUriString) {
                        cursorPosition = editor.selection.active;
                    }
                    
                    tree.set(content, cursorPosition);
                    outputChannel.appendLine('CtrlZTree: Document changed and processed (debounced).');
                    
                    const panel = activeVisualizationPanels.get(docUriString);
                    if (panel) {
                        postUpdatesToWebview(panel, tree, docUriString);
                        outputChannel.appendLine(`CtrlZTree: Panel for ${docUriString} updated after file change.`);
                    } else {
                        outputChannel.appendLine(`CtrlZTree: No panel open for ${docUriString} on file change.`);
                    }
                } else {
                    outputChannel.appendLine('CtrlZTree: Document content matches tree content - skipping update.');
                }
            } catch (e: any) {
                outputChannel.appendLine(`CtrlZTree: Error in processDocumentChange: ${e.message} Stack: ${e.stack}`);
                vscode.window.showErrorMessage(`CtrlZTree processDocumentChange error: ${e.message}`);
            } finally {
                processingDocuments.delete(docUriString);
                pendingChanges.delete(docUriString);
            }
        }

        // Process document changes with action-based grouping for better undo granularity
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async event => {
            if (isApplyingEdit) { 
                outputChannel.appendLine('CtrlZTree: onDidChangeTextDocument - skipping due to isApplyingEdit.');
                return; 
            } 
            
            if (event.document.uri.scheme === 'file' || event.document.uri.scheme === 'untitled') {
                const docUriString = event.document.uri.toString();
                const currentText = event.document.getText();
                const editor = vscode.window.activeTextEditor;
                
                // Get current cursor position if this is the active document
                let currentPosition: vscode.Position | undefined;
                if (editor && editor.document.uri.toString() === docUriString) {
                    currentPosition = editor.selection.active;
                }
                
                // Determine change type and whether to group
                const tree = getOrCreateTree(event.document);
                const lastContent = tree.getContent();
                const changeType = detectChangeType(lastContent, currentText);
                
                const shouldGroup = currentPosition ? 
                    shouldGroupWithPreviousChange(docUriString, currentText, currentPosition, changeType) : 
                    false;
                
                // Update tracking info
                lastChangeTime.set(docUriString, Date.now());
                if (currentPosition) {
                    lastCursorPosition.set(docUriString, currentPosition);
                }
                lastChangeType.set(docUriString, changeType);
                
                // Store the latest content for this document
                pendingChanges.set(docUriString, currentText);
                
                // Clear any existing timeout for this document
                const existingTimeout = documentChangeTimeouts.get(docUriString);
                if (existingTimeout) {
                    clearTimeout(existingTimeout);
                }
                
                // If we shouldn't group, process immediately, otherwise use shorter timeout
                const delay = shouldGroup ? ACTION_TIMEOUT : 50; // Process ungrouped changes almost immediately
                
                // Set a new timeout to process the change
                const newTimeout = setTimeout(() => {
                    const pendingContent = pendingChanges.get(docUriString);
                    if (pendingContent !== undefined) {
                        processDocumentChange(event.document, pendingContent);
                    }
                    documentChangeTimeouts.delete(docUriString);
                }, delay);
                
                documentChangeTimeouts.set(docUriString, newTimeout);
                outputChannel.appendLine(`CtrlZTree: Document change scheduled for ${docUriString} (group: ${shouldGroup}, delay: ${delay}ms, type: ${changeType}, cursor: ${currentPosition?.line}:${currentPosition?.character})`);
            }
        });
        outputChannel.appendLine('CtrlZTree: onDidChangeTextDocument subscribed.');
        
        // Listen for color theme changes to update webview styling
        const themeChangeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
            outputChannel.appendLine('CtrlZTree: Color theme changed, updating webviews...');
            // Notify all active webviews about theme change
            for (const panel of activeVisualizationPanels.values()) {
                if (panel.visible) {
                    panel.webview.postMessage({ command: 'updateTheme' });
                }
            }
        });
        
        // Listen for active editor changes to update tree view
        const activeEditorChangeSubscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (!editor) {
                outputChannel.appendLine('CtrlZTree: Active editor changed to none.');
                return;
            }
            
            const docUriString = editor.document.uri.toString();
            outputChannel.appendLine(`CtrlZTree: Active editor changed to ${docUriString}`);
            
            // Check if there's already an active panel
            const existingPanel = activeVisualizationPanels.get(docUriString);
            if (existingPanel && typeof existingPanel.reveal === 'function') {
                // If there's already a panel for this document, just reveal it
                outputChannel.appendLine(`CtrlZTree: Revealing existing panel for ${docUriString}`);
                let fileName = editor.document.uri.path.split(/[\\/]/).pop() || 'Untitled';
                if (!fileName || fileName.trim() === '') {
                    fileName = 'Untitled';
                }
                existingPanel.title = `CtrlZTree ${fileName}`;
                const tree = getOrCreateTree(editor.document);
                postUpdatesToWebview(existingPanel, tree, docUriString);
                existingPanel.reveal(vscode.ViewColumn.Beside, false);
            } else {
                // Check if any other panel is currently active and update it to show this document's tree
                for (const [otherDocUri, panel] of activeVisualizationPanels.entries()) {
                    if (panel.visible && typeof panel.reveal === 'function') {
                        outputChannel.appendLine(`CtrlZTree: Updating visible panel to show tree for ${docUriString}`);
                        let fileName = editor.document.uri.path.split(/[\\/]/).pop() || 'Untitled';
                        if (!fileName || fileName.trim() === '') {
                            fileName = 'Untitled';
                        }
                        panel.title = `CtrlZTree ${fileName}`;
                        const tree = getOrCreateTree(editor.document);
                        postUpdatesToWebview(panel, tree, docUriString);
                        
                        // Update the mapping to point to the new document
                        activeVisualizationPanels.delete(otherDocUri);
                        activeVisualizationPanels.set(docUriString, panel);
                        break;
                    }
                }
            }
        });
        
        outputChannel.appendLine('CtrlZTree: Registering undo command...');
        const undoCommand = vscode.commands.registerCommand('ctrlztree.undo', async () => {
            outputChannel.appendLine('CtrlZTree: undo command invoked.');
            const editor = vscode.window.activeTextEditor;
            if (!editor) { return; }
            
            const document = editor.document;
            const tree = getOrCreateTree(document);
            
            // Check if current file is empty and use special behavior
            const currentContent = document.getText();
            let newHead: string | null;
            
            if (currentContent.trim() === '') {
                // File is empty, try to go to latest non-empty state
                newHead = tree.zToLatestNonEmpty();
                if (newHead) {
                    outputChannel.appendLine('CtrlZTree: File is empty, jumping to latest non-empty state.');
                } else {
                    // No non-empty state found, use regular undo
                    newHead = tree.z();
                }
            } else {
                // File has content, use regular undo
                newHead = tree.z();
            }
            
            if (newHead) {
                isApplyingEdit = true;
                try {
                    const content = tree.getContent();
                    const cursorPosition = tree.getCursorPosition();
                    
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(0, 0, document.lineCount, 0),
                        content
                    );
                    await vscode.workspace.applyEdit(edit);
                    
                    // Restore cursor position if available
                    if (cursorPosition) {
                        // Ensure cursor position is within document bounds
                        const maxLine = document.lineCount - 1;
                        const adjustedLine = Math.min(cursorPosition.line, maxLine);
                        const maxChar = document.lineAt(adjustedLine).text.length;
                        const adjustedChar = Math.min(cursorPosition.character, maxChar);
                        const adjustedPosition = new vscode.Position(adjustedLine, adjustedChar);
                        
                        editor.selection = new vscode.Selection(adjustedPosition, adjustedPosition);
                        editor.revealRange(new vscode.Range(adjustedPosition, adjustedPosition));
                    }
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
                    const cursorPosition = tree.getCursorPosition();
                    
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(0, 0, document.lineCount, 0),
                        content
                    );
                    await vscode.workspace.applyEdit(edit);
                    
                    // Restore cursor position if available
                    if (cursorPosition) {
                        // Ensure cursor position is within document bounds
                        const maxLine = document.lineCount - 1;
                        const adjustedLine = Math.min(cursorPosition.line, maxLine);
                        const maxChar = document.lineAt(adjustedLine).text.length;
                        const adjustedChar = Math.min(cursorPosition.character, maxChar);
                        const adjustedPosition = new vscode.Position(adjustedLine, adjustedChar);
                        
                        editor.selection = new vscode.Selection(adjustedPosition, adjustedPosition);
                        editor.revealRange(new vscode.Range(adjustedPosition, adjustedPosition));
                    }
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
                    // Get git-style diff preview for branch selection
                    const currentContent = tree.getContent(); // Current state
                    const branchContent = tree.getContent(hash); // Target branch state
                    const diffPreview = generateDiffSummary(currentContent, branchContent);
                    
                    return {
                        label: `Branch ${hash.substring(0, 8)}`,
                        description: diffPreview.replace(/\n/g, ' | '), // Format for single-line description
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
                        const cursorPosition = tree.getCursorPosition();
                        
                        const edit = new vscode.WorkspaceEdit();
                        edit.replace(
                            document.uri,
                            new vscode.Range(0, 0, document.lineCount, 0),
                            content
                        );
                        await vscode.workspace.applyEdit(edit);
                        
                        // Restore cursor position if available
                        if (cursorPosition) {
                            // Ensure cursor position is within document bounds
                            const maxLine = document.lineCount - 1;
                            const adjustedLine = Math.min(cursorPosition.line, maxLine);
                            const maxChar = document.lineAt(adjustedLine).text.length;
                            const adjustedChar = Math.min(cursorPosition.character, maxChar);
                            const adjustedPosition = new vscode.Position(adjustedLine, adjustedChar);
                            
                            editor.selection = new vscode.Selection(adjustedPosition, adjustedPosition);
                            editor.revealRange(new vscode.Range(adjustedPosition, adjustedPosition));
                        }
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

        context.subscriptions.push(changeDocumentSubscription, themeChangeSubscription, activeEditorChangeSubscription, undoCommand, redoCommand, visualizeCommand);
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

export function deactivate() {
    // Clean up any pending timeouts
    for (const timeout of documentChangeTimeouts.values()) {
        clearTimeout(timeout);
    }
    documentChangeTimeouts.clear();
    pendingChanges.clear();
    lastChangeTime.clear();
    lastCursorPosition.clear();
    lastChangeType.clear();
}



