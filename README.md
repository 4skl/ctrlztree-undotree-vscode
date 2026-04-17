# CtrlZTree - Visual Undo History for VS Code

CtrlZTree brings tree-based undo/redo functionality to VS Code, inspired by the [undotree for Vim](https://github.com/mbbill/undotree). Unlike traditional linear undo/redo that loses alternative edit paths, CtrlZTree preserves all your editing history in a branching tree structure.

## ✨ Features

### 🌳 Tree-Based History
- **Branching History**: Never lose edit alternatives when you undo and make new changes
- **Visual Tree View**: See your entire editing history as an interactive graph
- **Smart Navigation**: Click any node to instantly jump to that state

### 🎯 Enhanced Undo/Redo
- **Custom Undo/Redo**: Replaces VS Code's default Ctrl+Z/Ctrl+Y with tree-aware operations
- **Native Pass-Through**: Smart detection for read-only editors, outputs, and Jupyter notebooks ensures native undo behavior isn't blocked in untracked contexts
- **Alternative Keybinding**: Ctrl+Shift+Z (Cmd+Shift+Z on Mac) also works for redo operations
- **Smart Undo Protection**: Initial file content is protected - can't undo past the state when file was opened
- **Smart Empty File Undo**: When file is empty and you press Ctrl+Z, automatically jumps to the latest non-empty state
- **Branch Selection**: When multiple redo paths exist, choose which branch to follow
- **Content Preview**: See previews of document states when selecting branches

### 📊 Interactive Visualization
- **Real-time Updates**: Tree view updates automatically as you edit
- **Dynamic Editor Switching**: Tree view automatically adapts when switching between different editor tabs/files
- **File-specific Trees**: Each open file maintains its own history tree
- **Seamless Multi-Document Support**: Single panel intelligently shows the history for whichever file is currently active
- **Visual Indicators**: Current position highlighted in red, other states in blue
- **Enhanced Tooltips**: Hover over nodes to see concise diff previews showing only changed lines
- **Smart Content Display**: Tooltips show git-style diffs with intelligent truncation for large changes
- **Floating Diff Button**: Click the "📊 View Diff" button below the current active node to see changes
- **Automatic Cleanup**: Previous diff views close automatically when opening a new one
- **Read-Only Document Handling**: Diff views and other read-only documents don't interfere with tree tracking

## 🚀 How It Works

### Automatic History Tracking
CtrlZTree automatically tracks every change you make to your files, building a tree structure where:
- Each **node** represents a unique document state
- Each **edge** connects a parent state to a child state  
- **Branches** form when you undo and then make different changes

### Smart Diff Storage
Instead of storing complete document copies, CtrlZTree uses intelligent diff algorithms:
- Only stores the differences between document states
- Uses SHA-256 hashing to identify identical states
- Applies diffs efficiently to reconstruct any historical state

### Tree Navigation
- **Linear Undo/Redo**: When there's only one path, behaves like normal undo/redo
- **Branch Selection**: When multiple paths exist, shows a picker with content previews
- **Visual Navigation**: Click any node in the tree view to jump directly to that state
- **Diff Comparison**: Select a node with a parent to see the diff indicator appear in the node, then click the bottom area to view changes

## 🎮 Usage

### Commands
- **CtrlZTree: Undo** - Navigate to parent node in history tree
- **CtrlZTree: Redo** - Navigate to child node (with branch selection if multiple paths)
- **CtrlZTree: Visualize History Tree** - Open interactive tree visualization

### Default Keybindings
- `Ctrl+Z` (Windows/Linux) / `Cmd+Z` (Mac) - CtrlZTree Undo
- `Ctrl+Y` (Windows/Linux) / `Cmd+Y` (Mac) - CtrlZTree Redo
- `Ctrl+Shift+Z` (Windows/Linux) / `Cmd+Shift+Z` (Mac) - CtrlZTree Redo (Alternative)

### Visualization Panel
1. Run the **"CtrlZTree: Visualize History Tree"** command
2. A new panel opens showing your edit history as an interactive graph
3. **Dynamic Updates**: Panel automatically switches to show the history tree of whichever file you're currently editing
4. **Current state** is prominently displayed at the top level with enhanced styling (larger, bold text and thicker border)
5. **Other states** appear in blue with standard styling
6. **Click any node** to navigate to that document state
7. **Diff button** appears below the current active node (if it has a parent)

## 📝 Recent Updates

For full release notes see [CHANGELOG.md](CHANGELOG.md). Recent highlights:

- **0.5.7 (2026-04-17)** — **Critical Fixes**: Fixed `RangeError` infinite loop crashes caused by hash collisions. Prevented OOM memory leaks on large files by switching to a prefix/suffix stripped block replacement diff. Single-character tracking bug resolved with eager document initialization. Native undo behavior preserved for untracked inputs like Jupyter Notebooks.
- **0.5.6 (2026-03-31)** — Fixed dynamic programming array lookahead bugs, hash collisions, tree resets, and refined algorithm performance.
- **0.5.5 (2026-03-31)** — Quality & robustness improvements: automatic history pruning with configurable limits (1000 nodes per document, 100 documents max), strict input validation for diff deserialization, code consolidation eliminating duplicate formatting functions, improved error handling with proper type safety, and memory leak prevention with automatic document cleanup.
- **0.5.4 (2025-12-08)** — Startup activation via `onStartupFinished` (plus `onEditSession` and commands) so change tracking and commands are ready as soon as VS Code launches restored editors.
- **0.5.3 (2025-12-02)** — Visualize command auto-resolves a document even before an editor is active; root and baseline always visible with undo back to empty; smarter panel targeting, clean-state detection, and a webview bootstrap handshake.
- **0.5.2 (2025-12-01)** — Root-state undo protection, diff-only node storage with whitespace-aware previews, and smarter whitespace batching (newline flush, 500 ms grouping for spaces/tabs).

See [CHANGELOG.md](CHANGELOG.md) for the complete history.

## ⚙️ Configuration

CtrlZTree provides configurable settings to control memory usage and pruning behavior:

### History Pruning Settings

- **`ctrlztree.enablePruning`** (boolean, default: `true`)
  - Enable or disable automatic history tree pruning. When disabled, history will grow indefinitely until you close the file.

- **`ctrlztree.maxHistoryNodesPerDocument`** (integer, default: `1000`, minimum: `100`)
  - Maximum number of history nodes to keep per document. When exceeded, the oldest nodes are removed while preserving the current state and recent history.
  - Example: Set to `500` for lower memory usage, or `2000` for more extensive history on powerful machines.

- **`ctrlztree.maxTrackedDocuments`** (integer, default: `100`, minimum: `1`)
  - Maximum number of documents to keep history for. When exceeded, histories for oldest (least recently used) closed documents are discarded.
  - Example: Set to `50` if working with many temporary files, or `200` for keeping more file histories.

### Example User Settings

```json
{
  "ctrlztree.enablePruning": true,
  "ctrlztree.maxHistoryNodesPerDocument": 500,
  "ctrlztree.maxTrackedDocuments": 50
}