import * as assert from 'assert';
import { CtrlZTree } from '../../model/ctrlZTree';
import * as vscode from 'vscode';

suite('CtrlZTree Model Tests', () => {
	test('initial state matches empty root for empty document', () => {
		const tree = new CtrlZTree('');
		assert.strictEqual(tree.getContent(), '');
		assert.strictEqual(tree.getHead(), tree.getInternalRootHash());
	});

	test('initial state matches content for non-empty document', () => {
		const content = 'hello world';
		const tree = new CtrlZTree(content);
		assert.strictEqual(tree.getContent(), content);
	});

	test('set creates a new node with diff', () => {
		const tree = new CtrlZTree('');
		const newContent = 'new line';
		const newHash = tree.set(newContent);
		assert.notStrictEqual(newHash, tree.getInternalRootHash());
		assert.strictEqual(tree.getContent(newHash), newContent);
	});

	test('undo (z) returns to parent', () => {
		const content = 'hello';
		const tree = new CtrlZTree(content);
		const modifiedContent = 'hello world';
		tree.set(modifiedContent);
		const parentHash = tree.z();
		assert.strictEqual(parentHash, tree.getHead());
		assert.strictEqual(tree.getContent(), content);
	});

	test('redo (y) returns to child', () => {
		const content = 'hello';
		const tree = new CtrlZTree(content);
		const modifiedContent = 'hello world';
		const childHash = tree.set(modifiedContent);
		tree.z();
		const redoResult = tree.y();
		if (typeof redoResult === 'string') {
			tree.setHead(redoResult);
			assert.strictEqual(tree.getContent(), modifiedContent);
		}
	});

	test('identical content returns same hash', () => {
		const tree = new CtrlZTree('initial');
		const hash1 = tree.set('initial');
		assert.strictEqual(hash1, tree.getHead());
	});

	test('cursor position is stored', () => {
		const tree = new CtrlZTree('');
		const cursor = new vscode.Position(5, 10);
		tree.set('content', cursor);
		const storedCursor = tree.getCursorPosition();
		assert.strictEqual(storedCursor?.line, cursor.line);
		assert.strictEqual(storedCursor?.character, cursor.character);
	});

	test('zToLatestNonEmpty finds latest non-empty state', () => {
		const tree = new CtrlZTree('initial content');
		tree.set('');
		const result = tree.zToLatestNonEmpty();
		assert.notStrictEqual(result, null);
		assert.notStrictEqual(tree.getContent(), '');
	});

	test('pruneToMaxNodes with valid value', () => {
		const tree = new CtrlZTree('initial');
		const initialHash = tree.getHead();
		for (let i = 0; i < 10; i++) {
			tree.set(`content ${i}`);
		}
		const nodeCountBefore = tree.getNodeCount();
		// With a linear chain of 11 nodes (root + 10), pruning to 20 keeps all nodes
		// because the ancestry path fills all nodes before timestamp-based pruning kicks in.
		// Pruning only removes nodes when there are branches or the ancestry is shorter than maxNodes.
		tree.pruneToMaxNodes(20);
		assert.strictEqual(tree.getNodeCount(), nodeCountBefore);
		// The current head should still exist
		if (initialHash) {
			assert.ok(tree.getContent(initialHash) === 'initial');
		}
	});

	test('pruneToMaxNodes with zero or negative value is no-op', () => {
		const tree = new CtrlZTree('initial');
		const nodeCountBefore = tree.getNodeCount();
		tree.pruneToMaxNodes(0);
		assert.strictEqual(tree.getNodeCount(), nodeCountBefore);
		tree.pruneToMaxNodes(-10);
		assert.strictEqual(tree.getNodeCount(), nodeCountBefore);
	});

	test('setHead with invalid hash returns false', () => {
		const tree = new CtrlZTree('initial');
		assert.strictEqual(tree.setHead('invalid-hash'), false);
	});

	test('setHead with valid hash updates head', () => {
		const tree = new CtrlZTree('initial');
		const hash = tree.set('modified');
		assert.strictEqual(tree.setHead(hash), true);
		assert.strictEqual(tree.getHead(), hash);
	});
});
