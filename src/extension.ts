import * as vscode from 'vscode';
import { generateDiffSummary } from './lcs';
import { CtrlZTree } from './model/ctrlZTree';
import { createExtensionState } from './state/extensionState';
import { DIFF_SCHEME, ACTION_TIMEOUT, PAUSE_THRESHOLD } from './constants';
import { createWebviewManager, WebviewManager } from './webview/webviewManager';
import { registerDocumentChangeTracking } from './services/changeTracker';
import { markEditorCleanIfAtInitialSnapshot } from './utils/editorState';

const extensionState = createExtensionState();

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('CtrlZTree');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('CtrlZTree: Extension activating...');

    let isApplyingEdit = false;

    const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
        provideTextDocumentContent(uri: vscode.Uri): string {
            return uri.query;
        }
    })();

    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffContentProvider)
    );

    const getOrCreateTree = (document: vscode.TextDocument): CtrlZTree => {
        const key = document.uri.toString();
        let tree = extensionState.historyTrees.get(key);
        if (!tree) {
            tree = new CtrlZTree(document.getText());
            extensionState.historyTrees.set(key, tree);
            outputChannel.appendLine(`CtrlZTree: Created new tree for ${key}`);
        }
        return tree;
    };

    const webviewManager = createWebviewManager({
        context,
        outputChannel,
        state: extensionState,
        getOrCreateTree,
        setIsApplyingEdit: value => {
            isApplyingEdit = value;
        }
    });

    const changeTracker = registerDocumentChangeTracking({
        context,
        outputChannel,
        state: extensionState,
        getOrCreateTree,
        webviewManager,
        isApplyingEdit: () => isApplyingEdit,
        setLastValidEditorUri: uri => {
            extensionState.lastValidEditorUri = uri;
        },
        actionTimeout: ACTION_TIMEOUT,
        pauseThreshold: PAUSE_THRESHOLD
    });
    context.subscriptions.push(changeTracker);

    const themeChangeSubscription = vscode.window.onDidChangeActiveColorTheme(() => {
        outputChannel.appendLine('CtrlZTree: Color theme changed, broadcasting refresh.');
        webviewManager.broadcastThemeRefresh();
    });

    const activeEditorChangeSubscription = vscode.window.onDidChangeActiveTextEditor(editor => {
        void webviewManager.handleActiveEditorChange(editor);
    });

    context.subscriptions.push(themeChangeSubscription, activeEditorChangeSubscription);

    if (vscode.window.activeTextEditor) {
        void webviewManager.handleActiveEditorChange(vscode.window.activeTextEditor);
    }

    const undoCommand = vscode.commands.registerCommand('ctrlztree.undo', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('CtrlZTree: No active editor for undo.');
            return;
        }

        const document = editor.document;
        const tree = getOrCreateTree(document);
        const previousHead = tree.getHead();
        const newHead = tree.z();

        if (!newHead) {
            outputChannel.appendLine('CtrlZTree: No more undo history.');
            vscode.window.showInformationMessage('CtrlZTree: No more undo history.');
            return;
        }

        outputChannel.appendLine(`CtrlZTree: Undo from ${previousHead} to ${newHead}`);
        await applyTreeStateToDocument(document, tree, () => {
            isApplyingEdit = true;
        }, () => {
            isApplyingEdit = false;
        });
        await markEditorCleanIfAtInitialSnapshot(tree, document, { outputChannel });
        updatePanelForDocument(tree, document.uri.toString(), webviewManager);
    });

    const redoCommand = vscode.commands.registerCommand('ctrlztree.redo', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('CtrlZTree: No active editor for redo.');
            return;
        }

        const document = editor.document;
        const tree = getOrCreateTree(document);
        const redoResult = tree.y();

        if (typeof redoResult === 'string') {
            await applyRedoBranch(tree, redoResult, document, webviewManager, () => {
                isApplyingEdit = true;
            }, () => {
                isApplyingEdit = false;
            });
            return;
        }

        if (redoResult.length === 0) {
            outputChannel.appendLine('CtrlZTree: No more redo history.');
            vscode.window.showInformationMessage('CtrlZTree: No more redo history.');
            return;
        }

        const currentContent = tree.getContent();
        const items = redoResult.map(hash => {
            const branchContent = tree.getContent(hash);
            const diffPreview = generateDiffSummary(currentContent, branchContent);
            return {
                label: `Branch ${hash.substring(0, 8)}`,
                description: diffPreview.replace(/\n/g, ' | '),
                hash
            };
        });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select branch to restore'
        });

        if (!selected) {
            return;
        }

        await applyRedoBranch(tree, selected.hash, document, webviewManager, () => {
            isApplyingEdit = true;
        }, () => {
            isApplyingEdit = false;
        });
    });

    async function resolveDocumentForVisualization(preferredDocument?: vscode.TextDocument): Promise<vscode.TextDocument | undefined> {
        if (isTrackableDocument(preferredDocument)) {
            return preferredDocument;
        }

        const activeDoc = vscode.window.activeTextEditor?.document;
        if (isTrackableDocument(activeDoc)) {
            return activeDoc;
        }

        const visibleEditor = vscode.window.visibleTextEditors.find(editor => isTrackableDocument(editor.document));
        if (visibleEditor) {
            return visibleEditor.document;
        }

        if (extensionState.lastValidEditorUri) {
            const matchingDoc = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === extensionState.lastValidEditorUri);
            if (isTrackableDocument(matchingDoc)) {
                return matchingDoc;
            }

            try {
                const reopened = await vscode.workspace.openTextDocument(vscode.Uri.parse(extensionState.lastValidEditorUri));
                if (isTrackableDocument(reopened)) {
                    return reopened;
                }
            } catch (error: any) {
                outputChannel.appendLine(`CtrlZTree: Could not reopen last edited document ${extensionState.lastValidEditorUri}: ${error.message}`);
            }
        }

        const workspaceDoc = vscode.workspace.textDocuments.find(isTrackableDocument);
        if (workspaceDoc) {
            return workspaceDoc;
        }

        return waitForNextTrackableEditor(2000);
    }

    function waitForNextTrackableEditor(timeoutMs: number): Promise<vscode.TextDocument | undefined> {
        return new Promise(resolve => {
            let settled = false;
            let timer: NodeJS.Timeout | undefined;

            const disposable = vscode.window.onDidChangeActiveTextEditor(editor => {
                if (isTrackableDocument(editor?.document) && !settled) {
                    settled = true;
                    if (timer) {
                        clearTimeout(timer);
                    }
                    disposable.dispose();
                    resolve(editor!.document);
                }
            });

            timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    disposable.dispose();
                    resolve(undefined);
                }
            }, timeoutMs);
        });
    }

    function isTrackableDocument(document: vscode.TextDocument | undefined): document is vscode.TextDocument {
        return !!document && (document.uri.scheme === 'file' || document.uri.scheme === 'untitled');
    }

    const visualizeCommand = vscode.commands.registerCommand('ctrlztree.visualize', async (uri?: vscode.Uri) => {
        let preferredDocument: vscode.TextDocument | undefined;

        if (uri) {
            try {
                preferredDocument = await vscode.workspace.openTextDocument(uri);
            } catch (error: any) {
                outputChannel.appendLine(`CtrlZTree: Failed to open provided document for visualize command: ${error.message}`);
            }
        }

        const targetDocument = await resolveDocumentForVisualization(preferredDocument);
        if (!targetDocument) {
            vscode.window.showInformationMessage('CtrlZTree: No active text document available to visualize yet.');
            return;
        }

        await webviewManager.showVisualizationForDocument(targetDocument);
    });

    context.subscriptions.push(undoCommand, redoCommand, visualizeCommand);

    outputChannel.appendLine('CtrlZTree: Extension activation completed successfully.');
}

export function deactivate() {
    for (const timeout of extensionState.documentChangeTimeouts.values()) {
        clearTimeout(timeout);
    }
    extensionState.documentChangeTimeouts.clear();
    extensionState.pendingChanges.clear();
    extensionState.lastChangeTime.clear();
    extensionState.lastCursorPosition.clear();
    extensionState.lastChangeType.clear();
    extensionState.processingDocuments.clear();
}

async function applyTreeStateToDocument(
    document: vscode.TextDocument,
    tree: CtrlZTree,
    onStart: () => void,
    onEnd: () => void
): Promise<void> {
    onStart();
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

        if (cursorPosition) {
            const maxLine = document.lineCount - 1;
            const adjustedLine = Math.min(cursorPosition.line, maxLine);
            const maxChar = document.lineAt(adjustedLine).text.length;
            const adjustedChar = Math.min(cursorPosition.character, maxChar);
            const adjustedPosition = new vscode.Position(adjustedLine, adjustedChar);
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.toString() === document.uri.toString()) {
                editor.selection = new vscode.Selection(adjustedPosition, adjustedPosition);
                editor.revealRange(new vscode.Range(adjustedPosition, adjustedPosition));
            }
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`CtrlZTree: Failed to apply edit: ${error.message}`);
    } finally {
        onEnd();
    }
}

async function applyRedoBranch(
    tree: CtrlZTree,
    targetHash: string,
    document: vscode.TextDocument,
    webviewManager: WebviewManager,
    onStart: () => void,
    onEnd: () => void
): Promise<void> {
    tree.setHead(targetHash);
    await applyTreeStateToDocument(document, tree, onStart, onEnd);
    await markEditorCleanIfAtInitialSnapshot(tree, document);
    updatePanelForDocument(tree, document.uri.toString(), webviewManager);
}

function updatePanelForDocument(
    tree: CtrlZTree,
    docUriString: string,
    webviewManager: WebviewManager
) {
    const panel = extensionState.activeVisualizationPanels.get(docUriString);
    if (panel) {
        webviewManager.postUpdatesToWebview(panel, tree, docUriString);
    }
}



