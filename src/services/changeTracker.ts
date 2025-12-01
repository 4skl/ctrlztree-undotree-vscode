import * as vscode from 'vscode';
import { CtrlZTree } from '../model/ctrlZTree';
import { ExtensionState, ChangeType } from '../state/extensionState';
import { WebviewManager } from '../webview/webviewManager';
import { DIFF_SCHEME } from '../constants';

interface ChangeTrackerDeps {
    context: vscode.ExtensionContext;
    outputChannel: vscode.OutputChannel;
    state: ExtensionState;
    getOrCreateTree: (document: vscode.TextDocument) => CtrlZTree;
    webviewManager: WebviewManager;
    isApplyingEdit: () => boolean;
    setLastValidEditorUri: (uri: string | null) => void;
    actionTimeout: number;
    pauseThreshold: number;
}

const WHITESPACE_FLUSH_DELAY = 500; // 500 ms

export function registerDocumentChangeTracking(deps: ChangeTrackerDeps): vscode.Disposable {
    const {
        context,
        outputChannel,
        state,
        getOrCreateTree,
        webviewManager,
        isApplyingEdit,
        setLastValidEditorUri,
        actionTimeout,
        pauseThreshold
    } = deps;

    const { documentChangeTimeouts, pendingChanges, lastChangeTime, lastCursorPosition, lastChangeType, processingDocuments, activeVisualizationPanels } = state;

    const subscription = vscode.workspace.onDidChangeTextDocument(async event => {
        if (isApplyingEdit()) {
            outputChannel.appendLine('CtrlZTree: onDidChangeTextDocument - skipping due to isApplyingEdit.');
            return;
        }

        if (event.document.uri.scheme === DIFF_SCHEME) {
            return;
        }

        const editorForDoc = vscode.window.visibleTextEditors.find(e => e.document === event.document);
        if (editorForDoc && editorForDoc.document.uri.scheme !== 'file' && editorForDoc.document.uri.scheme !== 'untitled') {
            outputChannel.appendLine(`CtrlZTree: Skipping read-only or special document with scheme: ${editorForDoc.document.uri.scheme}`);
            return;
        }

        if (event.document.uri.scheme !== 'file' && event.document.uri.scheme !== 'untitled') {
            return;
        }

        const docUriString = event.document.uri.toString();
        setLastValidEditorUri(docUriString);

        const currentText = event.document.getText();
        const activeEditor = vscode.window.activeTextEditor;

        let currentPosition: vscode.Position | undefined;
        if (activeEditor && activeEditor.document.uri.toString() === docUriString) {
            currentPosition = activeEditor.selection.active;
        }

        const tree = getOrCreateTree(event.document);
        const lastContent = tree.getContent();
        const changeType = detectChangeType(lastContent, currentText);
        const shouldGroup = currentPosition ? shouldGroupWithPreviousChange(state, docUriString, currentPosition, changeType, pauseThreshold) : false;
        const separatorTrigger = detectSeparatorTrigger(event.contentChanges);

        lastChangeTime.set(docUriString, Date.now());
        if (currentPosition) {
            lastCursorPosition.set(docUriString, currentPosition);
        }
        lastChangeType.set(docUriString, changeType);
        pendingChanges.set(docUriString, currentText);

        const existingTimeout = documentChangeTimeouts.get(docUriString);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
            documentChangeTimeouts.delete(docUriString);
        }

        if (separatorTrigger === 'newline') {
            processDocumentChange(event.document, currentText);
            outputChannel.appendLine(`CtrlZTree: Document change flushed immediately due to newline separator for ${docUriString}.`);
            return;
        }

        const delay = separatorTrigger === 'whitespace'
            ? WHITESPACE_FLUSH_DELAY
            : shouldGroup ? actionTimeout : 50;
        const newTimeout = setTimeout(() => {
            const pendingContent = pendingChanges.get(docUriString);
            if (pendingContent !== undefined) {
                processDocumentChange(event.document, pendingContent);
            }
            documentChangeTimeouts.delete(docUriString);
        }, delay);

        documentChangeTimeouts.set(docUriString, newTimeout);
        outputChannel.appendLine(`CtrlZTree: Document change scheduled for ${docUriString} (group: ${shouldGroup}, separatorTrigger: ${separatorTrigger ?? 'none'}, delay: ${delay}ms, type: ${changeType}, cursor: ${currentPosition?.line}:${currentPosition?.character})`);
    });

    context.subscriptions.push(subscription);
    outputChannel.appendLine('CtrlZTree: onDidChangeTextDocument subscribed.');

    return subscription;

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

            if (content !== currentTreeContent) {
                let cursorPosition: vscode.Position | undefined;
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document.uri.toString() === docUriString) {
                    cursorPosition = editor.selection.active;
                }

                tree.set(content, cursorPosition);
                outputChannel.appendLine('CtrlZTree: Document changed and processed (debounced).');

                const panel = activeVisualizationPanels.get(docUriString);
                if (panel) {
                    webviewManager.postUpdatesToWebview(panel, tree, docUriString);
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
}

function shouldGroupWithPreviousChange(
    state: ExtensionState,
    docUriString: string,
    currentPosition: vscode.Position,
    changeType: ChangeType,
    pauseThreshold: number
): boolean {
    const lastTime = state.lastChangeTime.get(docUriString);
    const lastPos = state.lastCursorPosition.get(docUriString);
    const lastType = state.lastChangeType.get(docUriString);
    const now = Date.now();

    if (!lastTime || !lastPos || !lastType) {
        return false;
    }

    if (now - lastTime > pauseThreshold) {
        return false;
    }

    if (changeType !== lastType) {
        return false;
    }

    const lineDiff = Math.abs(currentPosition.line - lastPos.line);
    const charDiff = Math.abs(currentPosition.character - lastPos.character);

    if (lineDiff > 1) {
        return false;
    }

    if (lineDiff === 0 && charDiff > 20) {
        return false;
    }

    if (lineDiff === 1 && charDiff > 10) {
        return false;
    }

    return true;
}

function detectChangeType(oldContent: string, newContent: string): ChangeType {
    const lengthDiff = newContent.length - oldContent.length;

    if (lengthDiff > 0) {
        return 'typing';
    }
    if (lengthDiff < 0) {
        return 'deletion';
    }
    return oldContent === newContent ? 'other' : 'typing';
}

type SeparatorTrigger = 'newline' | 'whitespace';

function detectSeparatorTrigger(changes: readonly vscode.TextDocumentContentChangeEvent[]): SeparatorTrigger | null {
    let sawWhitespace = false;

    for (const change of changes) {
        if (!change.text) {
            continue;
        }

        if (/\r|\n/.test(change.text)) {
            return 'newline';
        }

        if (change.text.trim() === '') {
            sawWhitespace = true;
        }
    }

    return sawWhitespace ? 'whitespace' : null;
}
