import * as vscode from 'vscode';
import { generateDiffSummary, deserializeDiff, DiffOperation } from '../lcs';
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

    function truncateInlineText(text: string, maxLength: number): string {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (!clean) {
            return 'Empty';
        }
        if (clean.length <= maxLength) {
            return clean;
        }
        return clean.substring(0, Math.max(0, maxLength - 3)) + '...';
    }

    function formatSegmentCollection(segments: string[], prefix: string): { label: string; tooltip: string } {
        if (segments.length === 0) {
            return { label: '', tooltip: '' };
        }

        const cleaned = segments.map(segment => segment.replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (cleaned.length === 0) {
            return { label: '', tooltip: '' };
        }

        const labelSegment = truncateInlineText(cleaned[0], 70);
        const tooltipSegments: string[] = [];
        const maxTooltipSegments = 4;

        for (let i = 0; i < cleaned.length && i < maxTooltipSegments; i++) {
            tooltipSegments.push(`${prefix} ${truncateInlineText(cleaned[i], 160)}`);
        }

        if (cleaned.length > maxTooltipSegments) {
            tooltipSegments.push(`${prefix} (+${cleaned.length - maxTooltipSegments} more)`);
        }

        return {
            label: `${prefix} ${labelSegment}`,
            tooltip: tooltipSegments.join('\n')
        };
    }

    function extractSegmentsFromDiff(diffStr: string, parentContent: string): { additions: string[]; removals: string[] } {
        const additions: string[] = [];
        const removals: string[] = [];

        let operations: DiffOperation[] = [];
        try {
            operations = deserializeDiff(diffStr);
        } catch {
            return { additions, removals };
        }

        for (const op of operations) {
            if (op.type === 'add' && typeof op.content === 'string') {
                additions.push(op.content);
            } else if (op.type === 'remove' && typeof op.length === 'number') {
                const position = typeof op.position === 'number' ? op.position : 0;
                const start = Math.max(0, Math.min(parentContent.length, position));
                const end = Math.max(start, Math.min(parentContent.length, start + op.length));
                const removedText = parentContent.slice(start, end);
                if (removedText) {
                    removals.push(removedText);
                }
            }
        }

        return { additions, removals };
    }

    function getNodeDiffPreview(node: TreeNode, tree: CtrlZTree): { label: string; tooltip: string } {
        try {
            const currentContent = tree.getContent(node.hash);
            const parentHash = node.parent;

            if (!parentHash || !node.diff) {
                const fallback = formatTextForNodeDisplay(currentContent);
                return { label: fallback, tooltip: fallback };
            }

            const parentContent = tree.getContent(parentHash);
            const { additions, removals } = extractSegmentsFromDiff(node.diff, parentContent);
            const addedPreview = formatSegmentCollection(additions, '+');
            const removedPreview = formatSegmentCollection(removals, '-');

            const labelParts = [addedPreview.label, removedPreview.label].filter(Boolean);
            const tooltipParts = [addedPreview.tooltip, removedPreview.tooltip].filter(Boolean);

            if (labelParts.length === 0) {
                const summary = generateDiffSummary(parentContent, currentContent);
                return { label: summary, tooltip: summary };
            }

            return {
                label: labelParts.join('\n'),
                tooltip: tooltipParts.join('\n')
            };
        } catch {
            const fallback = formatTextForNodeDisplay(tree.getContent(node.hash));
            return { label: fallback, tooltip: fallback };
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

            const diffPreview = getNodeDiffPreview(node, tree);
            const previewLabel = diffPreview.label || 'No textual changes';
            const previewTooltip = diffPreview.tooltip || previewLabel;
            const timeAgo = formatTimeAgo(node.timestamp);
            const hasParent = node.parent !== null;

            nodesArrayForVis.push({
                id: shortHash,
                label: `${timeAgo}\n${shortHash}\n${previewLabel}`,
                title: `${timeAgo}\nHash: ${shortHash}\n${previewTooltip}`,
                hasParent,
                baseLabel: `${timeAgo}\n${shortHash}\n${previewLabel}`
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

    async function getWebviewContent(initialNodes: any[], initialEdges: any[], currentHeadShortHash: string | null, webview: vscode.Webview, fileName: string): Promise<string> {
        const templateUri = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'webview.html');
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'webview.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'webview.js'));
        const visNetworkUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'resources', 'vis-network.min.js'));

        try {
            const raw = await vscode.workspace.fs.readFile(templateUri);
            const template = Buffer.from(raw).toString('utf8');

            const filled = template
                .replace(/%CSP_SOURCE%/g, webview.cspSource)
                .replace(/%STYLE_URI%/g, String(styleUri))
                .replace(/%SCRIPT_URI%/g, String(scriptUri))
                .replace(/%VIS_NETWORK_URI%/g, String(visNetworkUri))
                .replace(/%TITLE%/g, fileName);

            const startupDataScript = `\n<script>\nwindow.initialData = { nodes: ${JSON.stringify(initialNodes)}, edges: ${JSON.stringify(initialEdges)}, headShortHash: ${currentHeadShortHash ? `'${currentHeadShortHash}'` : 'null'} };\n</script>\n`;

            return filled.replace('</head>', `</head>${startupDataScript}`);
        } catch (e: any) {
            outputChannel.appendLine(`CtrlZTree: Failed to load webview template: ${e.message}`);
            return `<!doctype html><html><body><pre>Failed to load webview template: ${e.message}</pre></body></html>`;
        }
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
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'resources'),
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'webview')
                ],
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
            const diffPreview = getNodeDiffPreview(node, tree);
            const previewLabel = diffPreview.label || 'No textual changes';
            const previewTooltip = diffPreview.tooltip || previewLabel;
            const timeAgo = formatTimeAgo(node.timestamp);
            nodesArrayForVis.push({
                id: shortHash,
                label: `${timeAgo}\n${shortHash}\n${previewLabel}`,
                title: `${timeAgo}\nHash: ${shortHash}\n${previewTooltip}`
            });
            if (node.parent && node.parent !== internalRootHash) {
                edgesArrayForVis.push({
                    from: node.parent.substring(0, 8),
                    to: shortHash
                });
            }
        });
        panelToFullHashMap.set(panel, initialFullHashMap);
        panel.webview.html = await getWebviewContent(nodesArrayForVis, edgesArrayForVis, currentHeadShortHash, panel.webview, fileName);

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
                    case 'dbgCoords':
                        try {
                            const d = message.data || {};
                            const msg = `CtrlZTree dbgCoords: node=${d.selectedNodeId} pos=${JSON.stringify(d.position)} dom=${JSON.stringify(d.domPosition)} scroll=(${d.scrollX},${d.scrollY}) left=${d.left} top=${d.top} clampedLeft=${d.clampedLeft} clampedTop=${d.clampedTop} view=${JSON.stringify(d.viewport)}`;
                            outputChannel.appendLine(msg);
                        } catch (e) {
                            outputChannel.appendLine(`CtrlZTree dbgCoords: failed to serialize debug message: ${e}`);
                        }
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
