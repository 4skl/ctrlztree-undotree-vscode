import * as vscode from 'vscode';
import { generateDiffSummary } from '../lcs';
import { CtrlZTree, TreeNode } from '../model/ctrlZTree';
import { ExtensionState } from '../state/extensionState';
import { DIFF_SCHEME } from '../constants';

interface ManagerDeps {
    context: vscode.ExtensionContext;
    outputChannel: vscode.OutputChannel;
    state: ExtensionState;
    getOrCreateTree: (document: vscode.TextDocument) => CtrlZTree;
    setIsApplyingEdit: (value: boolean) => void;
}

export interface WebviewManager {
    postUpdatesToWebview(panel: vscode.WebviewPanel, tree: CtrlZTree, documentUriString: string): void;
    showVisualizationForDocument(documentToShow?: vscode.TextDocument): Promise<void>;
    broadcastThemeRefresh(): void;
    handleActiveEditorChange(editor: vscode.TextEditor | undefined): Promise<void>;
}

export function createWebviewManager({
    context,
    outputChannel,
    state,
    getOrCreateTree,
    setIsApplyingEdit
}: ManagerDeps): WebviewManager {
    const { activeVisualizationPanels, panelToFullHashMap, historyTrees, lastChangeTime, lastCursorPosition, lastChangeType, pendingChanges, documentChangeTimeouts } = state;

    function formatTimeAgo(timestamp: number): string {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            return `${days} day${days === 1 ? '' : 's'} ago`;
        }
        if (hours > 0) {
            return `${hours} hour${hours === 1 ? '' : 's'} ago`;
        }
        if (minutes > 0) {
            return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
        }
        if (seconds > 5) {
            return `${seconds} seconds ago`;
        }
        return 'Just now';
    }

    function isPanelValid(panel: vscode.WebviewPanel): boolean {
        try {
            return panel.visible !== undefined && panel.webview !== undefined;
        } catch {
            return false;
        }
    }

    function safePostMessage(panel: vscode.WebviewPanel, message: any): boolean {
        try {
            if (isPanelValid(panel)) {
                panel.webview.postMessage(message);
                return true;
            }
            return false;
        } catch (error) {
            outputChannel.appendLine(`CtrlZTree: Error posting message to webview: ${error}`);
            return false;
        }
    }

    function formatTextForNodeDisplay(text: string): string {
        if (!text || text.trim() === '') {
            return 'Empty content';
        }
        const cleanText = text.replace(/\s+/g, ' ').trim();
        if (cleanText.length > 80) {
            return cleanText.substring(0, 37) + '\n...\n' + cleanText.substring(cleanText.length - 37);
        }
        return cleanText;
    }

    function getAddedTextPreview(node: TreeNode, tree: CtrlZTree): string {
        try {
            if (node.fullContent !== undefined) {
                return formatTextForNodeDisplay(node.fullContent);
            }

            const parentHash = node.parent;
            if (!parentHash) {
                const currentContent = tree.getContent(node.hash);
                return formatTextForNodeDisplay(currentContent);
            }

            if (!node.diff) {
                return 'Initial commit';
            }

            const parentContent = tree.getContent(parentHash);
            const currentContent = tree.getContent(node.hash);

            return generateDiffSummary(parentContent, currentContent);
        } catch {
            return 'Parse error';
        }
    }

    function postUpdatesToWebview(panel: vscode.WebviewPanel, tree: CtrlZTree, documentUriString: string) {
        if (!isPanelValid(panel)) {
            outputChannel.appendLine(`CtrlZTree: Skipping update to disposed webview for ${documentUriString}`);
            return;
        }

        const nodes = tree.getAllNodes();
        const internalRootHash = tree.getInternalRootHash();
        const nodesArrayForVis: any[] = [];
        const edgesArrayForVis: any[] = [];
        const currentFullHashMap = new Map<string, string>();
        const currentHeadFullHash = tree.getHead();
        let currentHeadShortHash: string | null = null;

        if (currentHeadFullHash) {
            currentHeadShortHash = currentHeadFullHash.substring(0, 8);
        }

        nodes.forEach((node, fullHash) => {
            if (fullHash === internalRootHash) {
                return;
            }

            const shortHash = fullHash.substring(0, 8);
            currentFullHashMap.set(shortHash, fullHash);

            const addedTextPreview = getAddedTextPreview(node, tree);
            const timeAgo = formatTimeAgo(node.timestamp);
            const hasParent = node.parent !== null;

            nodesArrayForVis.push({
                id: shortHash,
                label: `${timeAgo}\n${shortHash}\n${addedTextPreview}`,
                title: `${timeAgo}\nHash: ${shortHash}\n${addedTextPreview}`,
                hasParent,
                baseLabel: `${timeAgo}\n${shortHash}\n${addedTextPreview}`
            });

            if (node.parent && node.parent !== internalRootHash) {
                edgesArrayForVis.push({
                    from: node.parent.substring(0, 8),
                    to: shortHash
                });
            }
        });

        panelToFullHashMap.set(panel, currentFullHashMap);

        const success = safePostMessage(panel, {
            command: 'updateTree',
            nodes: nodesArrayForVis,
            edges: edgesArrayForVis,
            headShortHash: currentHeadShortHash
        });

        if (success) {
            outputChannel.appendLine(`CtrlZTree: Posted updates to webview for ${documentUriString}`);
        } else {
            outputChannel.appendLine(`CtrlZTree: Failed to post updates to webview for ${documentUriString} - panel may be disposed`);
        }
    }

    function getWebviewContent(initialNodes: any[], initialEdges: any[], currentHeadShortHash: string | null, webview: vscode.Webview, fileName: string): string {
        const visNetworkUri = webview.asWebviewUri(vscode.Uri.joinPath(
            context.extensionUri,
            'resources',
            'vis-network.min.js'
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
                <style>${getStyles()}</style>
            </head>
            <body>
                <div id="toolbar">
                    <button id="reload-btn" class="toolbar-btn" title="Reload Tree Visualization">🔄 Reload</button>
                    <button id="reset-btn" class="toolbar-btn" title="Reset Tree (Start Fresh from Current State)">🧽 Reset</button>
                </div>
                <div id="tree-visualization"></div>
                <button id="diff-button">📊 View Diff</button>
                <script>${getWebviewScript(initialNodes, initialEdges, currentHeadShortHash)}</script>
            </body>
            </html>
        `;
    }

    function getStyles(): string {
        return `
            :root {
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
                position: relative;
            }
            .vis-network canvas {
                background-color: var(--vscode-background) !important;
            }
            .vis-network:hover {
                cursor: pointer !important;
            }
            #diff-button {
                position: absolute;
                display: none;
                background-color: var(--vscode-button-background, #0e639c);
                color: var(--vscode-button-foreground, #ffffff);
                border: 1px solid var(--vscode-button-border, #0e639c);
                border-radius: 3px;
                padding: 4px 12px;
                font-size: 11px;
                font-family: var(--vscode-font-family);
                cursor: pointer;
                white-space: nowrap;
                z-index: 1000;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
                transition: background-color 0.15s ease;
            }
            #diff-button:hover {
                background-color: var(--vscode-button-hoverBackground, #1177bb);
            }
            #diff-button:active {
                background-color: var(--vscode-button-hoverBackground, #0d5a8f);
                transform: translateY(1px);
            }
        `;
    }

    function getWebviewScript(initialNodes: any[], initialEdges: any[], currentHeadShortHash: string | null): string {
        const currentHeadValue = currentHeadShortHash ? `'${currentHeadShortHash}'` : 'null';
        return `
            try {
                const vscode = acquireVsCodeApi(); 
                let network = null;
                let nodes = new vis.DataSet(${JSON.stringify(initialNodes)});
                let edges = new vis.DataSet(${JSON.stringify(initialEdges)});
                let currentHeadNodeId = ${currentHeadValue};
                const container = document.getElementById('tree-visualization');
                const reloadBtn = document.getElementById('reload-btn');
                if (reloadBtn) {
                    reloadBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'requestTreeReload' });
                    });
                }
                const resetBtn = document.getElementById('reset-btn');
                if (resetBtn) {
                    resetBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'requestTreeReset' });
                    });
                }
                const diffButton = document.getElementById('diff-button');
                const options = {
                    layout: {
                        hierarchical: {
                            direction: 'UD',
                            sortMethod: 'directed'
                        }
                    },
                    nodes: {
                        shape: 'box',
                        margin: 10,
                        widthConstraint: { maximum: 220 },
                        font: { size: 14 }
                    },
                    edges: {
                        arrows: 'to'
                    },
                    interaction: {
                        hover: true,
                        navigationButtons: true,
                        keyboard: true
                    }
                };
                network = new vis.Network(container, { nodes, edges }, options);
                network.on('selectNode', params => {
                    if (params.nodes.length === 0) {
                        return;
                    }
                    const selectedNodeId = params.nodes[0];
                    const node = nodes.get(selectedNodeId);
                    if (!node) {
                        return;
                    }
                    if (node.hasParent) {
                        const position = network.getPositions([selectedNodeId])[selectedNodeId];
                        const domPosition = network.canvasToDOM({ x: position.x, y: position.y });
                        diffButton.style.left = \`\${domPosition.x - diffButton.offsetWidth / 2}px\`;
                        diffButton.style.top = \`\${domPosition.y + 30}px\`;
                        diffButton.style.display = 'block';
                        diffButton.onclick = () => {
                            vscode.postMessage({ command: 'openDiff', shortHash: selectedNodeId });
                        };
                    } else {
                        diffButton.style.display = 'none';
                    }
                });
                network.on('deselectNode', () => {
                    diffButton.style.display = 'none';
                });
                network.on('click', params => {
                    if (params.nodes.length === 0) {
                        return;
                    }
                    vscode.postMessage({ command: 'navigateToNode', shortHash: params.nodes[0] });
                });
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'updateTree':
                            nodes.clear();
                            edges.clear();
                            nodes.add(message.nodes);
                            edges.add(message.edges);
                            currentHeadNodeId = message.headShortHash;
                            break;
                        case 'updateTheme':
                            break;
                    }
                });
            } catch (error) {
                vscode.postMessage({ command: 'webviewError', error: { message: error.message, stack: error.stack } });
            }
        `;
    }

    function resetDocumentTracking(docUriString: string) {
        lastChangeTime.delete(docUriString);
        lastCursorPosition.delete(docUriString);
        lastChangeType.delete(docUriString);
        pendingChanges.delete(docUriString);
        const existingTimeout = documentChangeTimeouts.get(docUriString);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            documentChangeTimeouts.delete(docUriString);
        }
    }

    async function showVisualizationForDocument(documentToShow?: vscode.TextDocument) {
        const editor = documentToShow ?? vscode.window.activeTextEditor?.document;
        if (!editor) {
            vscode.window.showInformationMessage('CtrlZTree: No active document to visualize.');
            return;
        }

        const docUriString = editor.uri.toString();
        const existingPanel = activeVisualizationPanels.get(docUriString);
        let fileName = editor.uri.path.split(/[\\/]/).pop() || 'Untitled';
        if (!fileName || fileName.trim() === '') {
            fileName = 'Untitled';
        }

        if (existingPanel && isPanelValid(existingPanel) && typeof existingPanel.reveal === 'function') {
            existingPanel.title = `CtrlZTree ${fileName}`;
            const tree = getOrCreateTree(editor);
            postUpdatesToWebview(existingPanel, tree, docUriString);
            existingPanel.reveal(vscode.ViewColumn.Beside, false);
            return;
        }

        if (existingPanel && !isPanelValid(existingPanel)) {
            activeVisualizationPanels.delete(docUriString);
        }

        const tree = getOrCreateTree(editor);
        const panel = vscode.window.createWebviewPanel(
            'ctrlzTreeVisualization',
            `CtrlZTree ${fileName}`,
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
        const internalRootHash = tree.getInternalRootHash();
        const currentHeadFullHash = tree.getHead();
        let currentHeadShortHash: string | null = null;

        if (currentHeadFullHash) {
            currentHeadShortHash = currentHeadFullHash.substring(0, 8);
        }

        nodes.forEach((node, fullHash) => {
            if (fullHash === internalRootHash) {
                return;
            }
            const shortHash = fullHash.substring(0, 8);
            initialFullHashMap.set(shortHash, fullHash);
            const addedTextPreview = getAddedTextPreview(node, tree);
            const timeAgo = formatTimeAgo(node.timestamp);
            nodesArrayForVis.push({
                id: shortHash,
                label: `${timeAgo}\n${shortHash}\n${addedTextPreview}`,
                title: `${timeAgo}\nHash: ${shortHash}\n${addedTextPreview}`
            });
            if (node.parent && node.parent !== internalRootHash) {
                edgesArrayForVis.push({
                    from: node.parent.substring(0, 8),
                    to: shortHash
                });
            }
        });
        panelToFullHashMap.set(panel, initialFullHashMap);
        panel.webview.html = getWebviewContent(nodesArrayForVis, edgesArrayForVis, currentHeadShortHash, panel.webview, fileName);

        panel.onDidChangeViewState(
            e => {
                if (e.webviewPanel.visible) {
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
                    case 'openDiff':
                        await handleOpenDiff(message.shortHash, docUriString, panel);
                        return;
                    case 'navigateToNode':
                        await handleNavigateToNode(message.shortHash, docUriString, panel);
                        return;
                    case 'requestTreeReload':
                        handleTreeReload(docUriString, panel);
                        return;
                    case 'requestTreeReset':
                        handleTreeReset(docUriString, panel);
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
                activeVisualizationPanels.delete(docUriString);
                panelToFullHashMap.delete(panel);
            },
            null,
            context.subscriptions
        );
    }

    async function handleOpenDiff(shortHash: string, docUriString: string, panel: vscode.WebviewPanel) {
        try {
            const currentPanelHashMap = panelToFullHashMap.get(panel);
            if (!currentPanelHashMap) {
                vscode.window.showErrorMessage('CtrlZTree: Internal error - hash map not found for this panel.');
                return;
            }

            const fullHash = currentPanelHashMap.get(shortHash);
            const targetTree = historyTrees.get(docUriString);

            if (!fullHash || !targetTree) {
                vscode.window.showWarningMessage(`CtrlZTree: Could not find node ${shortHash} for diff.`);
                return;
            }

            const allNodes = targetTree.getAllNodes();
            const node = allNodes.get(fullHash);

            if (!node || !node.parent) {
                vscode.window.showInformationMessage('CtrlZTree: This is the root node, no parent to compare with.');
                return;
            }

            const parentContent = targetTree.getContent(node.parent);
            const currentContent = targetTree.getContent(fullHash);
            const parentShortHash = node.parent.substring(0, 8);
            const fileName = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === docUriString)?.uri.path.split(/[\\/]/).pop() || 'document';

            const parentUri = vscode.Uri.parse(`${DIFF_SCHEME}:${fileName} @ ${parentShortHash}?${encodeURIComponent(parentContent)}`);
            const currentUri = vscode.Uri.parse(`${DIFF_SCHEME}:${fileName} @ ${shortHash}?${encodeURIComponent(currentContent)}`);

            if (state.lastOpenedDiffEditor && !state.lastOpenedDiffEditor.document.isClosed) {
                const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
                const diffTab = tabs.find(tab => tab.input instanceof vscode.TabInputTextDiff && (tab.input.original.scheme === DIFF_SCHEME || tab.input.modified.scheme === DIFF_SCHEME));
                if (diffTab) {
                    await vscode.window.tabGroups.close(diffTab);
                }
            }

            await vscode.commands.executeCommand(
                'vscode.diff',
                parentUri,
                currentUri,
                `${fileName}: ${parentShortHash} ↔ ${shortHash}`,
                {
                    viewColumn: vscode.ViewColumn.Beside,
                    preview: false
                }
            );

            const openedDiffEditor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.scheme === DIFF_SCHEME);
            if (openedDiffEditor) {
                state.lastOpenedDiffEditor = openedDiffEditor;
            }
        } catch (e: any) {
            outputChannel.appendLine(`CtrlZTree: Error opening diff: ${e.message} Stack: ${e.stack}`);
            vscode.window.showErrorMessage(`CtrlZTree: Could not open diff: ${e.message}`);
        }
    }

    async function handleNavigateToNode(shortHash: string, docUriString: string, panel: vscode.WebviewPanel) {
        const allVisibleEditors = vscode.window.visibleTextEditors;
        let targetEditor = allVisibleEditors.find(editor => editor.document.uri.toString() === docUriString);

        if (!targetEditor) {
            const targetDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === docUriString);
            if (targetDocument) {
                try {
                    targetEditor = await vscode.window.showTextDocument(targetDocument, vscode.ViewColumn.Active);
                } catch (e: any) {
                    vscode.window.showErrorMessage(`CtrlZTree: Could not open target document: ${e.message}`);
                    return;
                }
            } else {
                vscode.window.showInformationMessage('CtrlZTree: The target file is not currently open. Please open the file first, then try navigation again.');
                return;
            }
        } else {
            try {
                targetEditor = await vscode.window.showTextDocument(targetEditor.document, {
                    viewColumn: targetEditor.viewColumn,
                    preserveFocus: false
                });
            } catch (e: any) {
                vscode.window.showErrorMessage(`CtrlZTree: Could not switch to target document: ${e.message}`);
                return;
            }
        }

        if (!targetEditor || targetEditor.document.uri.toString() !== docUriString) {
            vscode.window.showErrorMessage('CtrlZTree: Could not activate target document for navigation.');
            return;
        }

        const currentPanelHashMap = panelToFullHashMap.get(panel);
        if (!currentPanelHashMap) {
            vscode.window.showErrorMessage('CtrlZTree: Internal error - hash map not found for this panel.');
            const recreatedTree = getOrCreateTree(targetEditor.document);
            postUpdatesToWebview(panel, recreatedTree, docUriString);
            vscode.window.showInformationMessage('CtrlZTree: Tree state restored. Please try navigation again.');
            return;
        }

        const fullHash = currentPanelHashMap.get(shortHash);
        const targetTree = historyTrees.get(docUriString);

        if (!targetTree) {
            const recreatedTree = getOrCreateTree(targetEditor.document);
            postUpdatesToWebview(panel, recreatedTree, docUriString);
            vscode.window.showInformationMessage('CtrlZTree: Tree recreated. Please try navigation again.');
            return;
        }

        if (!fullHash) {
            vscode.window.showWarningMessage(`CtrlZTree: Node ${shortHash} not found. The tree may have been updated.`);
            postUpdatesToWebview(panel, targetTree, docUriString);
            return;
        }

        const success = targetTree.setHead(fullHash);
        if (success) {
            setIsApplyingEdit(true);
            try {
                const content = targetTree.getContent();
                const cursorPosition = targetTree.getCursorPosition();
                const edit = new vscode.WorkspaceEdit();
                const activeDoc = targetEditor.document;
                edit.replace(
                    activeDoc.uri,
                    new vscode.Range(0, 0, activeDoc.lineCount, 0),
                    content
                );
                const applyResult = await vscode.workspace.applyEdit(edit);
                if (!applyResult) {
                    throw new Error('WorkspaceEdit was not applied successfully');
                }

                if (cursorPosition) {
                    const maxLine = activeDoc.lineCount - 1;
                    const adjustedLine = Math.min(cursorPosition.line, maxLine);
                    const maxChar = activeDoc.lineAt(adjustedLine).text.length;
                    const adjustedChar = Math.min(cursorPosition.character, maxChar);
                    const adjustedPosition = new vscode.Position(adjustedLine, adjustedChar);
                    targetEditor.selection = new vscode.Selection(adjustedPosition, adjustedPosition);
                    targetEditor.revealRange(new vscode.Range(adjustedPosition, adjustedPosition));
                }
            } catch (e: any) {
                vscode.window.showErrorMessage(`CtrlZTree navigation error: ${e.message}`);
            } finally {
                setIsApplyingEdit(false);
            }

            const navPanel = activeVisualizationPanels.get(docUriString);
            if (navPanel) {
                postUpdatesToWebview(navPanel, targetTree, docUriString);
            }
        } else {
            vscode.window.showWarningMessage(`CtrlZTree: Could not find node for hash ${shortHash}`);
        }
    }

    function handleTreeReload(docUriString: string, panel: vscode.WebviewPanel) {
        try {
            const targetDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === docUriString);
            if (targetDocument) {
                const tree = getOrCreateTree(targetDocument);
                postUpdatesToWebview(panel, tree, docUriString);
            } else {
                vscode.window.showWarningMessage('CtrlZTree: Could not reload - document not found');
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(`CtrlZTree reload error: ${e.message}`);
        }
    }

    function handleTreeReset(docUriString: string, panel: vscode.WebviewPanel) {
        try {
            const targetDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === docUriString);
            if (!targetDocument) {
                vscode.window.showWarningMessage('CtrlZTree: Could not reset - document not found');
                return;
            }

            historyTrees.delete(docUriString);
            const newTree = new CtrlZTree(targetDocument.getText());
            historyTrees.set(docUriString, newTree);

            let cursorPosition: vscode.Position | undefined;
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.toString() === docUriString) {
                cursorPosition = editor.selection.active;
            }
            if (cursorPosition) {
                newTree.set(targetDocument.getText(), cursorPosition);
            }

            resetDocumentTracking(docUriString);
            postUpdatesToWebview(panel, newTree, docUriString);
            vscode.window.showInformationMessage('CtrlZTree: Tree reset - starting fresh from current state');
        } catch (e: any) {
            vscode.window.showErrorMessage(`CtrlZTree reset error: ${e.message}`);
        }
    }

    function broadcastThemeRefresh() {
        for (const [docUri, panel] of activeVisualizationPanels.entries()) {
            if (isPanelValid(panel) && panel.visible) {
                const success = safePostMessage(panel, { command: 'updateTheme' });
                if (!success) {
                    activeVisualizationPanels.delete(docUri);
                }
            } else if (!isPanelValid(panel)) {
                activeVisualizationPanels.delete(docUri);
            }
        }
    }

    async function handleActiveEditorChange(editor: vscode.TextEditor | undefined): Promise<void> {
        if (!editor) {
            outputChannel.appendLine('CtrlZTree: Active editor changed to none.');
            return;
        }

        const scheme = editor.document.uri.scheme;
        if (scheme !== 'file' && scheme !== 'untitled') {
            outputChannel.appendLine(`CtrlZTree: Skipping read-only/special editor with scheme: ${scheme}`);
            if (state.lastValidEditorUri) {
                const lastValidDoc = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === state.lastValidEditorUri);
                if (lastValidDoc) {
                    const tree = historyTrees.get(state.lastValidEditorUri);
                    const panel = activeVisualizationPanels.get(state.lastValidEditorUri);
                    if (tree && panel && isPanelValid(panel)) {
                        outputChannel.appendLine(`CtrlZTree: Showing tree for last valid editor: ${state.lastValidEditorUri}`);
                        postUpdatesToWebview(panel, tree, state.lastValidEditorUri);
                    }
                }
            }
            return;
        }

        const docUriString = editor.document.uri.toString();
        outputChannel.appendLine(`CtrlZTree: Active editor changed to ${docUriString}`);
        state.lastValidEditorUri = docUriString;

        const existingPanel = activeVisualizationPanels.get(docUriString);
        if (existingPanel && isPanelValid(existingPanel) && typeof existingPanel.reveal === 'function') {
            let fileName = editor.document.uri.path.split(/[\\/]/).pop() || 'Untitled';
            if (!fileName || fileName.trim() === '') {
                fileName = 'Untitled';
            }
            existingPanel.title = `CtrlZTree ${fileName}`;
            const tree = getOrCreateTree(editor.document);
            postUpdatesToWebview(existingPanel, tree, docUriString);
            existingPanel.reveal(vscode.ViewColumn.Beside, false);
            return;
        }

        if (existingPanel && !isPanelValid(existingPanel)) {
            activeVisualizationPanels.delete(docUriString);
        }

        for (const [otherDocUri, panel] of activeVisualizationPanels.entries()) {
            if (isPanelValid(panel) && panel.visible && typeof panel.reveal === 'function') {
                let fileName = editor.document.uri.path.split(/[\\/]/).pop() || 'Untitled';
                if (!fileName || fileName.trim() === '') {
                    fileName = 'Untitled';
                }
                panel.title = `CtrlZTree ${fileName}`;
                const tree = getOrCreateTree(editor.document);
                postUpdatesToWebview(panel, tree, docUriString);
                activeVisualizationPanels.delete(otherDocUri);
                activeVisualizationPanels.set(docUriString, panel);
                return;
            } else if (!isPanelValid(panel)) {
                activeVisualizationPanels.delete(otherDocUri);
            }
        }
    }

    return {
        postUpdatesToWebview,
        showVisualizationForDocument,
        broadcastThemeRefresh,
        handleActiveEditorChange
    };
}
