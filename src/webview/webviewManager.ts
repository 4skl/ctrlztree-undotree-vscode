import * as vscode from 'vscode';
import { generateDiffSummary, deserializeDiff, DiffOperation, formatTextForDisplay } from '../lcs';
import { CtrlZTree, TreeNode } from '../model/ctrlZTree';
import { ExtensionState } from '../state/extensionState';
import { DIFF_SCHEME } from '../constants';
import { markEditorCleanIfAtInitialSnapshot } from '../utils/editorState';

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
    showVisualizationForTree(tree: CtrlZTree, docUriString: string, title: string): Promise<void>;
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
    const panelDocumentContexts = new Map<vscode.WebviewPanel, { docUriString: string; document: vscode.TextDocument }>();
    let persistentPanel: vscode.WebviewPanel | null = null;
    let persistentPanelDocUriString: string | null = null;

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

    function truncateInlineText(text: string, maxLength: number): string {
        if (!text) {
            return 'Empty';
        }
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, Math.max(0, maxLength - 3)) + '...';
    }

    function summarizeWhitespaceSegment(segment: string): string {
        if (!segment) {
            return 'whitespace';
        }

        const parts: string[] = [];
        const spaceCount = (segment.match(/ /g) || []).length;
        if (spaceCount) {
            parts.push(`spaces x${spaceCount}`);
        }

        const tabCount = (segment.match(/\t/g) || []).length;
        if (tabCount) {
            parts.push(`tabs x${tabCount}`);
        }

        const segmentWithoutCRLF = segment.replace(/\r\n/g, '');
        const crlfCount = (segment.match(/\r\n/g) || []).length;
        if (crlfCount) {
            parts.push(`CRLF x${crlfCount}`);
        }

        const newlineCount = (segmentWithoutCRLF.match(/\n/g) || []).length;
        if (newlineCount) {
            parts.push(`LF x${newlineCount}`);
        }

        const carriageCount = (segmentWithoutCRLF.match(/\r/g) || []).length;
        if (carriageCount) {
            parts.push(`CR x${carriageCount}`);
        }

        return parts.length ? `whitespace (${parts.join(', ')})` : 'whitespace';
    }

    function annotateInlineWhitespace(segment: string): string {
        return segment
            .replace(/\r\n/g, '<CRLF>')
            .replace(/\r/g, '<CR>')
            .replace(/\n/g, '<LF>')
            .replace(/\t/g, '<TAB>')
            .replace(/ {2,}/g, match => `<SPx${match.length}>`);
    }

    function formatSegmentText(segment: string): { short: string; long: string } | null {
        if (!segment) {
            return null;
        }

        const hasVisibleCharacters = /[^\s]/.test(segment);
        if (!hasVisibleCharacters) {
            const summary = summarizeWhitespaceSegment(segment);
            return { short: summary, long: summary };
        }

        const annotated = annotateInlineWhitespace(segment);
        const needsQuotes = /^\s/.test(segment) || /\s$/.test(segment);
        const normalized = needsQuotes ? `"${annotated}"` : annotated;

        return {
            short: truncateInlineText(normalized, 70),
            long: truncateInlineText(normalized, 160)
        };
    }

    function formatSegmentCollection(segments: string[], prefix: string): { label: string; tooltip: string } {
        if (segments.length === 0) {
            return { label: '', tooltip: '' };
        }

        const described = segments
            .map(segment => formatSegmentText(segment))
            .filter((item): item is { short: string; long: string } => Boolean(item));

        if (described.length === 0) {
            return { label: '', tooltip: '' };
        }

        const labelSegment = described[0].short;
        const tooltipSegments: string[] = [];
        const maxTooltipSegments = 4;

        for (let i = 0; i < described.length && i < maxTooltipSegments; i++) {
            tooltipSegments.push(`${prefix} ${described[i].long}`);
        }

        if (described.length > maxTooltipSegments) {
            tooltipSegments.push(`${prefix} (+${described.length - maxTooltipSegments} more)`);
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
                const fallback = formatTextForDisplay(currentContent);
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
            const fallback = formatTextForDisplay(tree.getContent(node.hash));
            return { label: fallback, tooltip: fallback };
        }
    }

    function postUpdatesToWebview(panel: vscode.WebviewPanel, tree: CtrlZTree, documentUriString: string) {
        if (!isPanelValid(panel)) {
            outputChannel.appendLine(`CtrlZTree: Skipping update to disposed webview for ${documentUriString}`);
            return;
        }

        const fileName = documentUriString.split(/[\\/]/).pop()?.split(':')[0] || 'document';

        const nodes = tree.getAllNodes();
        const internalRootHash = tree.getInternalRootHash();
        const initialSnapshotHash = tree.getInitialSnapshotHash();
        const nodesArrayForVis: any[] = [];
        const edgesArrayForVis: any[] = [];
        const currentFullHashMap = new Map<string, string>();
        const currentHeadFullHash = tree.getHead();
        let currentHeadShortHash: string | null = null;

        const fullHashes = Array.from(nodes.keys());
        const shortHashForFullHash = new Map<string, string>();
        for (const fullHash of fullHashes) {
            let length = 8;
            let displayHash = fullHash.substring(0, length);
            while (length < fullHash.length) {
                const matches = fullHashes.filter(otherHash => otherHash.substring(0, length) === displayHash);
                if (matches.length === 1) {
                    break;
                }
                length = Math.min(fullHash.length, length + 8);
                displayHash = fullHash.substring(0, length);
            }
            shortHashForFullHash.set(fullHash, displayHash);
        }

        if (currentHeadFullHash) {
            currentHeadShortHash = shortHashForFullHash.get(currentHeadFullHash) ?? currentHeadFullHash;
        }

        nodes.forEach((node, fullHash) => {
            const shortHash = shortHashForFullHash.get(fullHash) ?? fullHash;
            currentFullHashMap.set(shortHash, fullHash);

            const isInternalRoot = fullHash === internalRootHash;
            const isInitialSnapshot = initialSnapshotHash !== null && fullHash === initialSnapshotHash;
            const isHead = fullHash === currentHeadFullHash;

            const diffPreview = isInitialSnapshot
                ? { label: 'Root (initial document state)', tooltip: 'Document content when CtrlZTree started tracking this file' }
                : isInternalRoot
                    ? initialSnapshotHash
                        ? { label: 'Empty baseline', tooltip: 'CtrlZTree internal starting point' }
                        : { label: 'Root (initial state)', tooltip: 'Starting point for this document' }
                    : getNodeDiffPreview(node, tree);
            const previewLabel = diffPreview.label || 'No textual changes';
            const previewTooltip = diffPreview.tooltip || previewLabel;
            const timeAgo = formatTimeAgo(node.timestamp);
            const liteDiffSummary = truncateInlineText(
                previewLabel.replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim(),
                72
            );

            // Get first line of content for richer node label
            let firstLine = '';
            try {
                const content = tree.getContent(fullHash);
                const trimmed = content.trim();
                if (trimmed) {
                    const firstNewline = content.indexOf('\n');
                    firstLine = firstNewline >= 0 ? content.substring(0, firstNewline).trim() : trimmed.substring(0, 60);
                    if (content.length > 60 && firstNewline < 0) {
                        firstLine = firstLine.substring(0, 57) + '...';
                    }
                }
            } catch {
                // ignore content extraction errors
            }

            // Determine node category for styling
            let category: 'root' | 'initial' | 'regular' | 'head';
            if (isInternalRoot) {category = 'root';}
            else if (isInitialSnapshot) {category = 'initial';}
            else if (isHead) {category = 'head';}
            else {category = 'regular';}

            const hasParent = node.parent !== null;

            nodesArrayForVis.push({
                id: shortHash,
                label: shortHash,
                caption: `${timeAgo}\n${liteDiffSummary}`,
                title: `${shortHash} — ${timeAgo}\n${previewTooltip}`,
                hasParent,
                category,
                firstLine,
                previewLabel,
                timeAgo,
                shortHash,
                fullHash,
                childrenCount: node.children.length
            });

            if (node.parent) {
                edgesArrayForVis.push({
                    from: shortHashForFullHash.get(node.parent) ?? node.parent,
                    to: shortHash
                });
            }
        });

        panelToFullHashMap.set(panel, currentFullHashMap);

        const success = safePostMessage(panel, {
            command: 'updateTree',
            nodes: nodesArrayForVis,
            edges: edgesArrayForVis,
            headShortHash: currentHeadShortHash,
            documentName: fileName
        });

        if (success) {
            outputChannel.appendLine(`CtrlZTree: Posted updates to webview for ${documentUriString}`);
        } else {
            outputChannel.appendLine(`CtrlZTree: Failed to post updates to webview for ${documentUriString} - panel may be disposed`);
        }
    }

    function updatePanelDocumentContext(panel: vscode.WebviewPanel, document: vscode.TextDocument) {
        const newDocUriString = document.uri.toString();
        
        // Clean up old association if this panel was previously associated with a different document
        const oldContext = panelDocumentContexts.get(panel);
        if (oldContext && oldContext.docUriString !== newDocUriString) {
            activeVisualizationPanels.delete(oldContext.docUriString);
        }
        
        // Update both maps atomically
        panelDocumentContexts.set(panel, {
            docUriString: newDocUriString,
            document
        });
        activeVisualizationPanels.set(newDocUriString, panel);
    }

    function getPanelDocumentContext(panel: vscode.WebviewPanel) {
        return panelDocumentContexts.get(panel);
    }

    async function getWebviewContent(webview: vscode.Webview, fileName: string): Promise<string> {
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
            return filled;
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
        let targetDocument = documentToShow ?? vscode.window.activeTextEditor?.document;

        if (!targetDocument && state.lastValidEditorUri) {
            const existingDoc = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === state.lastValidEditorUri);
            if (existingDoc) {
                targetDocument = existingDoc;
            } else {
                try {
                    const fallbackUri = vscode.Uri.parse(state.lastValidEditorUri);
                    targetDocument = await vscode.workspace.openTextDocument(fallbackUri);
                } catch (err: any) {
                    outputChannel.appendLine(`CtrlZTree: Failed to reopen last edited document ${state.lastValidEditorUri}: ${err.message}`);
                }
            }
        }

        if (!targetDocument) {
            vscode.window.showInformationMessage('CtrlZTree: No active document to visualize.');
            return;
        }

        state.lastValidEditorUri = targetDocument.uri.toString();
        const docUriString = targetDocument.uri.toString();
        const tree = getOrCreateTree(targetDocument);
        let fileName = targetDocument.uri.path.split(/[\\/]/).pop() || 'Untitled';
        if (!fileName || fileName.trim() === '') {
            fileName = 'Untitled';
        }

        // Use persistent panel if available and valid
        if (persistentPanel && isPanelValid(persistentPanel)) {
            persistentPanel.title = `CtrlZTree ${fileName}`;
            updatePanelDocumentContext(persistentPanel, targetDocument);
            persistentPanelDocUriString = docUriString;
            postUpdatesToWebview(persistentPanel, tree, docUriString);
            persistentPanel.reveal(vscode.ViewColumn.Beside, false);
            return;
        }

        // Create new persistent panel
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
        persistentPanel = panel;
        persistentPanelDocUriString = docUriString;
        updatePanelDocumentContext(panel, targetDocument);
        panel.webview.html = await getWebviewContent(panel.webview, fileName);

        panel.onDidChangeViewState(
            e => {
                const panelContext = getPanelDocumentContext(panel);
                if (!panelContext) {
                    return;
                }
                const { docUriString } = panelContext;
                if (e.webviewPanel.visible) {
                    const currentTree = historyTrees.get(docUriString);
                    if (currentTree) {
                        postUpdatesToWebview(panel, currentTree, docUriString);
                    }
                }
            },
            null,
            context.subscriptions
        );

        panel.webview.onDidReceiveMessage(
            async message => {
                const panelContext = getPanelDocumentContext(panel);
                if (!panelContext) {
                    outputChannel.appendLine('CtrlZTree: No panel context available for message handling.');
                    return;
                }
                const { docUriString, document: contextDocument } = panelContext;
                switch (message.command) {
                    case 'webviewReady': {
                        const currentTree = historyTrees.get(docUriString) ?? getOrCreateTree(contextDocument);
                        postUpdatesToWebview(panel, currentTree, docUriString);
                        return;
                    }
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
                persistentPanel = null;
                persistentPanelDocUriString = null;
                panelDocumentContexts.delete(panel);
                panelToFullHashMap.delete(panel);
            },
            null,
            context.subscriptions
        );
    }

    async function showVisualizationForTree(tree: CtrlZTree, docUriString: string, title: string) {
        // Use persistent panel if available and valid
        if (persistentPanel && isPanelValid(persistentPanel)) {
            let fileName = docUriString.split(/[\\/]/).pop() || 'document';
            if (!fileName || fileName.trim() === '') {
                fileName = 'document';
            }
            persistentPanel.title = `CtrlZTree ${title}`;
            persistentPanelDocUriString = docUriString;
            postUpdatesToWebview(persistentPanel, tree, docUriString);
            persistentPanel.reveal(vscode.ViewColumn.Beside, false);
            return;
        }

        // Create new panel
        const panel = vscode.window.createWebviewPanel(
            'ctrlzTreeVisualization',
            `CtrlZTree ${title}`,
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
        persistentPanel = panel;
        persistentPanelDocUriString = docUriString;

        const targetDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === docUriString);
        if (targetDocument) {
            updatePanelDocumentContext(panel, targetDocument);
        }
        let fn = docUriString.split(/[\\/]/).pop() || 'document';
        if (!fn || fn.trim() === '') {
            fn = 'document';
        }
        panel.webview.html = await getWebviewContent(panel.webview, fn);

        panel.onDidChangeViewState(
            e => {
                const panelContext = getPanelDocumentContext(panel);
                if (!panelContext) {
                    return;
                }
                const { docUriString } = panelContext;
                if (e.webviewPanel.visible) {
                    const currentTree = historyTrees.get(docUriString);
                    if (currentTree) {
                        postUpdatesToWebview(panel, currentTree, docUriString);
                    }
                }
            },
            null,
            context.subscriptions
        );

        panel.webview.onDidReceiveMessage(
            async message => {
                const panelContext = getPanelDocumentContext(panel);
                if (!panelContext) {
                    outputChannel.appendLine('CtrlZTree: No panel context available for message handling.');
                    return;
                }
                const { docUriString, document: contextDocument } = panelContext;
                switch (message.command) {
                    case 'webviewReady': {
                        const currentTree = historyTrees.get(docUriString) ?? getOrCreateTree(contextDocument);
                        postUpdatesToWebview(panel, currentTree, docUriString);
                        return;
                    }
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
                persistentPanel = null;
                persistentPanelDocUriString = null;
                panelDocumentContexts.delete(panel);
                panelToFullHashMap.delete(panel);
            },
            null,
            context.subscriptions
        );

        postUpdatesToWebview(panel, tree, docUriString);
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

            const parentQuery = encodeURIComponent(JSON.stringify({ docUri: docUriString, hash: node.parent }));
            const currentQuery = encodeURIComponent(JSON.stringify({ docUri: docUriString, hash: fullHash }));

            const parentUri = vscode.Uri.parse(`${DIFF_SCHEME}:${fileName} @ ${parentShortHash}?${parentQuery}`);
            const currentUri = vscode.Uri.parse(`${DIFF_SCHEME}:${fileName} @ ${shortHash}?${currentQuery}`);

            await vscode.commands.executeCommand(
                'vscode.diff',
                parentUri,
                currentUri,
                `${fileName}: ${parentShortHash} ↔ ${shortHash}`,
                {
                    viewColumn: vscode.ViewColumn.Beside,
                    preview: true,
                    preserveFocus: true
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

                await markEditorCleanIfAtInitialSnapshot(targetTree, activeDoc, {
                    targetHash: fullHash,
                    outputChannel
                });
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
            // Create fresh tree with current document content
            // The constructor already initializes with set(content), so we don't call set() again
            const newTree = new CtrlZTree(targetDocument.getText());
            historyTrees.set(docUriString, newTree);

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
            updatePanelDocumentContext(existingPanel, editor.document);
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
                updatePanelDocumentContext(panel, editor.document);
                return;
            } else if (!isPanelValid(panel)) {
                activeVisualizationPanels.delete(otherDocUri);
            }
        }
    }

    return {
        postUpdatesToWebview,
        showVisualizationForDocument,
        showVisualizationForTree,
        broadcastThemeRefresh,
        handleActiveEditorChange
    };
}
