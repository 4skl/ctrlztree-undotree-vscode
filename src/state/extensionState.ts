import * as vscode from 'vscode';
import { CtrlZTree } from '../model/ctrlZTree';

export type ChangeType = 'typing' | 'deletion' | 'other';

export interface ExtensionState {
    documentChangeTimeouts: Map<string, NodeJS.Timeout>;
    pendingChanges: Map<string, string>;
    lastChangeTime: Map<string, number>;
    lastCursorPosition: Map<string, vscode.Position>;
    lastChangeType: Map<string, ChangeType>;
    historyTrees: Map<string, CtrlZTree>;
    activeVisualizationPanels: Map<string, vscode.WebviewPanel>;
    panelToFullHashMap: Map<vscode.WebviewPanel, Map<string, string>>;
    processingDocuments: Set<string>;
    lastValidEditorUri: string | null;
    lastOpenedDiffEditor: vscode.TextEditor | null;
}

export function createExtensionState(): ExtensionState {
    return {
        documentChangeTimeouts: new Map<string, NodeJS.Timeout>(),
        pendingChanges: new Map<string, string>(),
        lastChangeTime: new Map<string, number>(),
        lastCursorPosition: new Map<string, vscode.Position>(),
        lastChangeType: new Map<string, ChangeType>(),
        historyTrees: new Map<string, CtrlZTree>(),
        activeVisualizationPanels: new Map<string, vscode.WebviewPanel>(),
        panelToFullHashMap: new Map<vscode.WebviewPanel, Map<string, string>>(),
        processingDocuments: new Set<string>(),
        lastValidEditorUri: null,
        lastOpenedDiffEditor: null
    };
}
