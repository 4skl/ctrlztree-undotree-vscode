import * as vscode from 'vscode';
import { CtrlZTree } from '../model/ctrlZTree';

interface MarkCleanOptions {
    outputChannel?: vscode.OutputChannel;
    targetHash?: string | null;
}

export async function markEditorCleanIfAtInitialSnapshot(
    tree: CtrlZTree,
    document: vscode.TextDocument,
    options: MarkCleanOptions = {}
): Promise<void> {
    const initialSnapshotHash = tree.getInitialSnapshotHash();
    const targetHash = options.targetHash ?? tree.getHead();

    if (!initialSnapshotHash || !targetHash || targetHash !== initialSnapshotHash) {
        return;
    }

    if (document.isUntitled || document.uri.scheme !== 'file') {
        return;
    }

    if (!document.isDirty) {
        return;
    }

    try {
        const savedContentBytes = await vscode.workspace.fs.readFile(document.uri);
        const savedContent = Buffer.from(savedContentBytes).toString('utf8');
        const snapshotContent = tree.getContent(initialSnapshotHash);

        if (savedContent === snapshotContent) {
            const didSave = await document.save();
            if (!didSave && options.outputChannel) {
                options.outputChannel.appendLine(`CtrlZTree: Unable to clear dirty state for ${document.uri.toString()} (save returned false).`);
            }
        }
    } catch (error: any) {
        if (options.outputChannel) {
            options.outputChannel.appendLine(`CtrlZTree: Failed to compare saved content against initial snapshot for ${document.uri.toString()}: ${error.message}`);
        }
    }
}
