// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { lcs_diff } from "./lcs";

//todo binary files check, use bytes instead of string ?

class CtrlZTree {
	hash: string; 
	diff: string; //? if first node, then diff is the whole file content (or empty ?)
	parent?: CtrlZTree;
	children?: Array<CtrlZTree>;
	constructor(hash: string, diff: string, parent?: CtrlZTree, children?: Array<CtrlZTree>) {
		this.hash = hash;
		this.diff = diff;
		this.parent = parent;
		this.children = children;
	}
};

//todo check if using document.uri.path is better than document.fileName or document.uri.external
declare global {
	//todo remove file if closed ? (or keep it in memory, thus solving file closed history problem)
	var ctrlztree_full: {[uri: string]: CtrlZTree}; // Each CtrlZTree heads for each files
}
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ctrlztree" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('ctrlztree.showtree', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Shall open the tree view of the current file\'s history since last git commit (or since the last save if not committed yet)');
	});

	let ctrlz = vscode.commands.registerCommand('ctrlztree.branchbackward', () => {
		vscode.window.showInformationMessage('Move Backward in CtrlZTree (Ctrl+Z)');
		const old_head = vscode.window.activeTextEditor?.document.getText();
		vscode.commands.executeCommand('undo');
		const new_head = vscode.window.activeTextEditor?.document.getText();
	});

	let ctrly = vscode.commands.registerCommand('ctrlztree.branchforward', () => {
		vscode.window.showInformationMessage('Move Forward in CtrlZTree (Ctrl+Y or Ctrl+Shift+Z)');
		//vscode.commands.executeCommand('redo'); // => so don't do this command, instead do the opposite of undo, by applying the next head in the current branch
	});

	let newbranch = vscode.commands.registerCommand('ctrlztree.newbranch', () => {
		vscode.window.showInformationMessage('Create new branch');
		const editor = vscode.window.activeTextEditor;
	});

	// todo improve, instead of making a diff each time the file is changed, make the diff only when important change is made (to think, but related to when a ctrlz o ctrl y is made then a modification is made)
	// todo ^...like save last state before ctrlz, then move on the tree with ctrlz and ctrly
	vscode.workspace.onDidChangeTextDocument(function(e) {
        console.log('changed.', e);
        console.log(e.document.isDirty);
    });

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}