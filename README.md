# CtrlZTree - Visual Undo History for VS Code

CtrlZTree brings tree-based undo/redo functionality to VS Code, inspired by the [undotree for Vim](https://github.com/mbbill/undotree). Unlike traditional linear undo/redo that loses alternative edit paths, CtrlZTree preserves all your editing history in a branching tree structure.

## ✨ Features

### 🌳 Tree-Based History
- **Branching History**: Never lose edit alternatives when you undo and make new changes
- **Visual Tree View**: See your entire editing history as an interactive graph
- **Smart Navigation**: Click any node to instantly jump to that state

### 🎯 Enhanced Undo/Redo
- **Custom Undo/Redo**: Replaces VS Code's default Ctrl+Z/Ctrl+Y with tree-aware operations
- **Alternative Keybinding**: Ctrl+Shift+Z (Cmd+Shift+Z on Mac) also works for redo operations
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
For full release notes see [CHANGELOG.md](CHANGELOG.md). Recent highlights:

- **0.5.0 (2025-11-29)** — Webview layout & styling fixes; project files updated for better project management.
- **0.4.1** — First-node snapshot fix (initial node stores full content).
- **0.4.0** — Floating diff button and automatic cleanup; improved diff UX.

See [CHANGELOG.md](CHANGELOG.md) for the complete history.

## 🤝 Contributing

We welcome contributions! This extension is under active development and there are many opportunities to help:

- **Bug Reports**: Found an issue? Please report it with steps to reproduce
- **Feature Requests**: Have ideas for improvements? We'd love to hear them
- **Code Contributions**: Check the planned features list for areas to contribute
- **Documentation**: Help improve this README or add code documentation

## 📚 Technical Details

### Architecture
- **Tree Storage**: Each document maintains a `CtrlZTree` instance with SHA-256 hashed nodes
- **Diff Engine**: Custom LCS (Longest Common Subsequence) algorithm for efficient change tracking  
- **Visualization**: Uses vis-network library for interactive graph rendering
- **State Management**: Centralized tracking of document trees and visualization panels

## 📖 References

- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Vim UndoTree Plugin](https://github.com/mbbill/undotree)
- [VS Code Extension API](https://code.visualstudio.com/api)

---

**Enjoy enhanced undo/redo with CtrlZTree! 🌳**
