// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import { sha256 } from 'js-sha256';

import { lcs_diff, Diff, diff_object } from "./lcs";

//todo binary files check, use bytes instead of string ?

//* Important thing to understand, the CtrlZTree is a tree of diffs, only the head node is the whole file.
//* ^...so the head node moving, some nodes will be, and added to the tree, in case of an undo not already registered in the tree
class CtrlZTree {
	hash: string; //if head node hash is validating the actual file state
	diff: Diff; // diff between this and parent
	parent?: CtrlZTree;
	children: Array<CtrlZTree>;
	constructor(hash: string, diff: Diff, parent?: CtrlZTree, children?: Array<CtrlZTree>) {
		this.hash = hash;
		this.diff = diff;
		this.parent = parent;
		if(children === undefined) {
			this.children = [];
		}else{
			this.children = children;
		}
	}
};
/*
//todo check if using document.uri.path is better than document.fileName or document.uri.external
declare global {
	//todo rewind tree if file is closed and persistant storage activated ?
	//todo remove file if closed ? (or keep it in memory, thus solving file closed history problem)
	var ctrlztree_full: {[uri: string]: CtrlZTree}; // Each CtrlZTree heads for each files
}
*/
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "ctrlztree" is now active!');
	context.globalState.update('ctrlztree_full', {}); //todo make it persistent
	context.globalState.update('ctrlztree_heads', {}); //todo make it persistent
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
		if(vscode.window.activeTextEditor === undefined) {
			vscode.commands.executeCommand('undo');
			return;
		}
		let ctrlztree_full = (context.globalState.get('ctrlztree_full') as {[uri: string]: CtrlZTree});
		const path = vscode.window.activeTextEditor.document.uri.path;
		const old_head = vscode.window.activeTextEditor.document.getText();
		const old_hash = sha256.create();
		old_hash.update(old_head);
		const old_hash_hex = old_hash.hex();
		vscode.commands.executeCommand('undo');
		const new_head = vscode.window.activeTextEditor.document.getText();
		const new_hash = sha256.create();
		new_hash.update(new_head);
		const new_hash_hex = new_hash.hex();
		console.log('old head', old_head);
		console.log('new head', new_head);
		const diff = diff_object(new_head, old_head); // => we did an undo, so we need to reverse the diff and the diff is added to the diff stack
		if(path in ctrlztree_full) {
			const new_head_node = new CtrlZTree(new_hash_hex, diff, undefined, [ctrlztree_full[path]]);
			ctrlztree_full[path].parent = new_head_node;
			ctrlztree_full[path] = new_head_node;
		}else{
			ctrlztree_full[path] = new CtrlZTree(new_hash_hex, diff);
		}
		context.globalState.update('ctrlztree_full', ctrlztree_full);
	});

	let ctrly = vscode.commands.registerCommand('ctrlztree.branchforward', () => {
		vscode.window.showInformationMessage('Move Forward in CtrlZTree (Ctrl+Y or Ctrl+Shift+Z)');
		if(vscode.window.activeTextEditor === undefined) {
			vscode.commands.executeCommand('redo'); // => so don't do this command, instead do the opposite of undo, by applying the next head in the current branch
			return;
		}
		let ctrlztree_full = (context.globalState.get('ctrlztree_full') as {[uri: string]: CtrlZTree});
		const path = vscode.window.activeTextEditor.document.uri.path;
		if(!(path in ctrlztree_full)) {
			vscode.window.showInformationMessage('No modifications registered in CtrlZTree for this file');
			return;
		}else if(ctrlztree_full[path].children.length === 0) {
			vscode.window.showInformationMessage('No more branch forward');
			return;
		}
		//todo branch forward (redo) => apply the diff of the next node in the tree; if multiple childs, ask which one to apply/notify

		const new_head = ctrlztree_full[path].diff.apply(vscode.window.activeTextEditor.document.getText());
		vscode.window.activeTextEditor.edit(editBuilder => {
			editBuilder.replace(new vscode.Range(0, 0, vscode.window.activeTextEditor?.document.lineCount || 0, 0), new_head);
		});
	});

	//todo add a new branch, with a new head, and a new node in the tree, thus creating a diff between the new head and the old head
	let newbranch = vscode.commands.registerCommand('ctrlztree.newbranch', () => {
		vscode.window.showInformationMessage('Create new branch');
		const editor = vscode.window.activeTextEditor;
		if(editor === undefined) {
			return;
		}
		const path = editor.document.uri.path;
		const head = editor.document.getText();
		const hash = sha256.create();
		hash.update(head);
		const hash_hex = hash.hex();
		
	});

	let debugbranch = vscode.commands.registerCommand('ctrlztree.debugbranch', () => {
		vscode.window.showInformationMessage('Debug branch');
		console.log('debug branch');
		let ctrlztree_full = (context.globalState.get('ctrlztree_full') as {[uri: string]: CtrlZTree});
		let ctrlztree_heads = (context.globalState.get('ctrlztree_full') as {[uri: string]: string});
		console.log('full tree', JSON.stringify(ctrlztree_full));
		console.log('heads', JSON.stringify(ctrlztree_heads));
		const editor = vscode.window.activeTextEditor;
		if(editor === undefined) {
			return;
		}
		const path = editor.document.uri.path;
		const head = editor.document.getText();
		const hash = sha256.create();
		hash.update(head);
		const hash_hex = hash.hex();
		const tree = ctrlztree_full[path];
		console.log(tree);
	});

	// todo improve, instead of making a diff each time the file is changed, make the diff only when important change is made (to think, but related to when a ctrlz o ctrl y is made then a modification is made)
	// todo ^...like save last state before ctrlz, then move on the tree with ctrlz and ctrly
	const stop_chars = [' ', '\n', '\t', '\r'];
	vscode.workspace.onDidChangeTextDocument(function(e) {
		if(vscode.window.activeTextEditor === undefined) {
			return;
		}
		if(e.contentChanges.length === 1){
			const change = e.contentChanges[0];
			if(change.text.length === 1 || !stop_chars.includes(change.text)) {
				console.log('simple change', change);
			}else{
				let ctrlztree_full = (context.globalState.get('ctrlztree_full') as {[uri: string]: CtrlZTree});
				let ctrlztree_heads = (context.globalState.get('ctrlztree_heads') as {[uri: string]: string});
				const path = vscode.window.activeTextEditor.document.uri.path;
				if(!(path in ctrlztree_heads)) {
					ctrlztree_heads[path] = '';
				}
				let old_head = ctrlztree_heads[path];
				let current_text = vscode.window.activeTextEditor.document.getText();
				const diff = diff_object(old_head, current_text);
				console.log('diff', diff);
				//const old_hash_hex = sha256.create().update(old_head).hex();
				const new_hash_hex = sha256.create().update(current_text).hex();
				if(path in ctrlztree_full) {
					const new_head_node = new CtrlZTree(new_hash_hex, diff, undefined, [ctrlztree_full[path]]);
					ctrlztree_full[path].parent = new_head_node;
					ctrlztree_full[path] = new_head_node;
				}else{
					ctrlztree_full[path] = new CtrlZTree(new_hash_hex, diff);
				}
				ctrlztree_heads[path] = current_text;
				context.globalState.update('ctrlztree_full', ctrlztree_full);
				context.globalState.update('ctrlztree_heads', ctrlztree_heads);
			}
		}
        console.log('changed.', e);
        console.log(e.document.isDirty);
    });

	context.subscriptions.push(disposable, ctrlz, ctrly, newbranch, debugbranch);
}

// This method is called when your extension is deactivated
export function deactivate() {}
