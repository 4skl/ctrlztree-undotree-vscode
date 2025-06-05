# CtrlZTree - Visual Undo History for VS Code

CtrlZTree brings tree-based undo/redo functionality to VS Code, inspired by the [undotree for Vim](https://github.com/mbbill/undotree). Unlike traditional linear undo/redo that loses alternative edit paths, CtrlZTree preserves all your editing history in a branching tree structure.

This project is based on the original [CtrlZTree](https://github.com/4skl/CtrlZTree) concept, adapted specifically for VS Code.

## ✨ Features

### 🌳 Tree-Based History
- **Branching History**: Never lose edit alternatives when you undo and make new changes
- **Visual Tree View**: See your entire editing history as an interactive graph
- **Smart Navigation**: Click any node to instantly jump to that state

### 🎯 Enhanced Undo/Redo
- **Custom Undo/Redo**: Replaces VS Code's default Ctrl+Z/Ctrl+Y with tree-aware operations
- **Branch Selection**: When multiple redo paths exist, choose which branch to follow
- **Content Preview**: See previews of document states when selecting branches

### 📊 Interactive Visualization
- **Real-time Updates**: Tree view updates automatically as you edit
- **File-specific Trees**: Each open file maintains its own history tree
- **Visual Indicators**: Current position highlighted in red, other states in blue
- **Enhanced Tooltips**: Hover over nodes to see concise diff previews showing only changed lines
- **Smart Content Display**: Tooltips show git-style diffs with intelligent truncation for large changes

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

## 🎮 Usage

### Commands
- **CtrlZTree: Undo** - Navigate to parent node in history tree
- **CtrlZTree: Redo** - Navigate to child node (with branch selection if multiple paths)
- **CtrlZTree: Visualize History Tree** - Open interactive tree visualization

### Default Keybindings
- `Ctrl+Z` (Windows/Linux) / `Cmd+Z` (Mac) - CtrlZTree Undo
- `Ctrl+Y` (Windows/Linux) / `Cmd+Y` (Mac) - CtrlZTree Redo

### Visualization Panel
1. Run the **"CtrlZTree: Visualize History Tree"** command
2. A new panel opens showing your edit history as an interactive graph
3. **Current state** is highlighted in red, **other states** in blue
4. **Click any node** to instantly navigate to that document state
5. **Hover over nodes** to see enhanced tooltips with concise change previews
6. **Panel title** shows "CtrlZTree \<filename\>" for easy identification

### Enhanced Tooltips (v0.2.0)
- **Git-style Diffs**: Tooltips show only the actual changed lines (+ and - lines)
- **Clean Display**: No redundant headers or duplicate text - just the essential changes
- **Smart Truncation**: Large diffs are limited to 15 lines with a "more changes" indicator
- **Better Readability**: Improved formatting for quick understanding of what changed

## 💡 Example Workflow

1. **Start editing** a file - CtrlZTree begins tracking changes
2. **Make some changes** (A → B → C)
3. **Undo twice** to return to state A
4. **Make different changes** (A → D → E)
5. **Open visualization** to see your branching history:
   ```
   A
   ├── B → C
   └── D → E (current)
   ```
6. **Click node C** to instantly return to that state
7. **Continue editing** to extend any branch

## 🔧 Requirements

- VS Code 1.60.0 or higher
- No additional dependencies required

## ⚙️ Extension Settings

Currently, CtrlZTree works out of the box with no configuration required. The extension:
- Automatically activates when VS Code starts
- Replaces default undo/redo keybindings when editing text
- Creates separate history trees for each file

## 🐛 Known Issues

- **History Persistence**: History trees are currently lost when VS Code is restarted or files are closed and reopened
- **Large Files**: Performance may be impacted on very large files due to diff calculations
- **Memory Usage**: Long editing sessions may accumulate significant history data

## 📋 Planned Features

- [ ] **Persistent History**: Save history trees to disk for persistence across sessions
- [ ] **History Cleanup**: Automatic pruning of old/unused branches
- [ ] **Export/Import**: Save and restore specific history states
- [ ] **Performance Optimization**: Better handling of large files and extensive histories
- [ ] **Search**: Find specific changes or content in history
- [ ] **Branch Naming**: Add custom labels to important history points

## 📊 Release Notes

### 0.2.5 (Current)

**Enhanced Visualization:**
- ✅ **Improved Node Display**: Clickable bubbles now show both commit ID and added text on separate lines
- ✅ **Better User Experience**: Made it easier to see what content was added at each commit directly in the visual tree nodes
- ✅ **Enhanced Readability**: Node labels display commit hash on first line and new text added on second line

### 0.2.4

**Enhanced Package Metadata:**
- ✅ **Improved Description**: Enhanced package.json with better description referencing the Undotree plugin inspiration
- ✅ **Added Keywords**: Comprehensive keywords for better discoverability including "vscode", "extension", "undotree", "history", "tree", "ctrlz"
- ✅ **Better Marketplace Presentation**: Enhanced metadata for improved VS Code Marketplace visibility

### 0.2.3

**Bug Fixes:**
- ✅ **Fixed LCS Algorithm**: Resolved an algorithmic bug in the Longest Common Subsequence (LCS) implementation in `lcs.ts`
- ✅ **Improved Diff Reliability**: Enhanced the reliability of diff generation and application
- Better handling of edge cases in text comparison and reconstruction

### 0.2.2

**Repository Update:**
- ✅ **Fixed Repository URL**: Updated package.json to point to the correct dedicated VS Code extension repository
- ✅ **Project Organization**: Now properly references `https://github.com/4skl/ctrlztree-undotree-vscode.git`
- No functional changes - purely organizational update

### 0.2.1

**Maintenance Release:**
- ✅ **Code Cleanup**: Removed unused `lcs_new.ts` file for cleaner project structure
- ✅ **Project Organization**: Eliminated redundant files not being used by the extension
- No functional changes - purely maintenance and cleanup

### 0.2.0

**Enhanced Tooltip Functionality:**
- ✅ **Improved Diff Display**: Tooltips now show only the changed lines (+ and - lines) from git-style diffs
- ✅ **Cleaner Interface**: Removed duplicate "Changes:" headers and redundant text
- ✅ **Smart Truncation**: Large diffs are intelligently limited to 15 lines with "more changes" indicator
- ✅ **Better Root Node Handling**: Initial content preview instead of generic "Root change" message
- ✅ **Enhanced Readability**: Concise, focused information about code changes in tooltips

### 0.1.0-0.1.9

**Initial Release Features:**
- ✅ Real-time history tree construction
- ✅ Visual tree representation with vis-network
- ✅ Interactive node navigation  
- ✅ Custom undo/redo with branch selection
- ✅ Per-file history tracking
- ✅ Efficient diff-based storage
- ✅ Current state highlighting

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

### File Structure
```
src/
├── extension.ts    # Main extension logic and VS Code integration
└── lcs.ts         # Diff algorithms and tree operations
```

## 📖 References

- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Original CtrlZTree Project](https://github.com/4skl/CtrlZTree)
- [Vim UndoTree Plugin](https://github.com/mbbill/undotree)
- [VS Code Extension API](https://code.visualstudio.com/api)

---

**Enjoy enhanced undo/redo with CtrlZTree! 🌳**
