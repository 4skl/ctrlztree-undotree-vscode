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
8. **Click the "📊 View Diff" button** to open a side-by-side diff view (opens beside the graph)
9. **Automatic cleanup**: Previous diff views close automatically when opening a new one
10. **Hover for tooltips** to see enhanced previews with concise change summaries
11. **Panel title** updates automatically to show "CtrlZTree \<filename\>" for the active file
12. **Seamless switching**: Move between different files and the tree view follows automatically
13. **Read-only handling**: When viewing diff or other read-only documents, tree shows last valid editor's history

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
6. **Navigate to node C** by clicking it
7. **A "📊 View Diff" button** appears below node E (the current active node)
8. **Click the button** to see what changed from D to E in a side-by-side diff view (opens beside the tree)
9. **Click another node** to navigate - the diff view automatically closes and a new button appears
10. **Continue editing** to extend any branch

## 🔧 Requirements

- VS Code 1.60.0 or higher
- No additional dependencies required

## ⚙️ Extension Settings

Currently, CtrlZTree works out of the box with no configuration required. The extension:
- Automatically activates when VS Code starts
- Replaces default undo/redo keybindings when editing text
- Creates separate history trees for each file
- Only tracks editable files (ignores read-only files, diff views, and special VS Code documents)

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

### 0.4.0 (Current)

**Floating Diff Button & Automatic Cleanup:**
- ✅ **Floating HTML Button**: Styled button appears below the current active node for diff viewing
- ✅ **Professional Styling**: VS Code theme-aware button with hover and active states
- ✅ **Dynamic Positioning**: Button automatically repositions on zoom, pan, and drag operations
- ✅ **Native VS Code Diff Viewer**: Uses VS Code's built-in diff viewer with syntax highlighting
- ✅ **Parent-Child Comparison**: Diff shows exactly what changed from parent to current node
- ✅ **Automatic Diff Cleanup**: Previous diff views close automatically when opening a new one
- ✅ **Workspace Cleanliness**: Only one diff view open at a time, preventing clutter
- ✅ **Separate Column View**: Diff opens beside the graph view, preserving both panels
- ✅ **Non-Tracked Diff Documents**: Diff view documents use special URI scheme to prevent circular tracking
- ✅ **Read-Only Document Handling**: Diff views and read-only editors properly excluded from tracking
- ✅ **Persistent Tree View**: When viewing read-only documents, tree shows last valid editor's history
- ✅ **Smart Button Visibility**: Button only appears on current head node with a parent

### 0.3.5

**Webview Stability & Error Handling:**
- ✅ **Fixed Webview Disposal Error**: Resolved "Webview is disposed" error that occurred when interacting with closed panels
- ✅ **Enhanced Panel Management**: Added proper panel validity checks before webview operations
- ✅ **Improved Error Handling**: Safe message posting with automatic cleanup of disposed panels
- ✅ **Better Stability**: More robust webview lifecycle management with enhanced error logging
- ✅ **Automatic Cleanup**: Disposed panels are automatically removed from tracking maps

### 0.3.4

**Dynamic Tree View & Multi-Document Support:**
- ✅ **Dynamic Tree View**: Tree view now automatically adapts when switching between editor tabs
- ✅ **Real-time Editor Switching**: Tree view updates automatically when user changes active editor
- ✅ **Seamless Multi-File Support**: Single tree view panel shows history for currently focused file
- ✅ **Enhanced Panel Management**: Reuses existing panels instead of creating multiple windows
- ✅ **Better Resource Usage**: Reduced memory usage with intelligent panel reuse

### 0.3.3

**Critical Production Fixes & Tree Layout:**
- ✅ **Fixed Tree Orientation**: Resolved horizontal tree layout issue by removing explicit level assignments
- ✅ **Production Deployment Fixed**: Replaced remote CDN with locally bundled vis-network library
- ✅ **Enhanced Current Node Visibility**: Improved visual styling with larger font, thicker border, and shadow effects
- ✅ **Offline Functionality**: All required libraries now bundled locally within extension
- ✅ **Better Resource Management**: Updated Content Security Policy to work with local resources only

### 0.3.2

**Documentation & Maintenance Update:**
- ✅ **Updated Documentation**: Comprehensive README update to reflect all features from 0.3.1 and 0.3.0
- ✅ **Enhanced Feature Descriptions**: Improved documentation of smart empty file undo and current node prominence
- ✅ **Complete Release History**: Full changelog integration with detailed feature descriptions

### 0.3.1

**Enhanced User Experience & Visual Improvements:**
- ✅ **Alternative Redo Keybinding**: Added Ctrl+Shift+Z (Cmd+Shift+Z on Mac) as alternative to Ctrl+Y for redo operations
- ✅ **Smart Empty File Undo**: Enhanced undo behavior for empty files - when file is empty and Ctrl+Z is pressed, jumps to the latest non-empty state in history
- ✅ **Current Node Prominence**: The active/current node now appears visually prominent in the tree view
  - Current node is positioned at the top level of the hierarchy 
  - Enhanced visual styling with larger, bold text and thicker border
  - Makes it easier to identify which state you're currently viewing
- ✅ **Improved Diff Display**: Fixed diff display logic to show both additions and removals for complete change visibility
- ✅ **Enhanced Whitespace Handling**: Better handling of whitespace-only changes in diff summaries

### 0.3.0

**Text Formatting & Diff Enhancements:**
- ✅ **Improved Text Formatting**: Implemented middle ellipsis display for long text content (first 37 chars + "..." + last 37 chars)
- ✅ **Smart Diff Summaries**: Enhanced diff summary logic showing net changes instead of separate additions/deletions
- ✅ **Pure Newline Detection**: Detects pure newline changes and displays as "+1 newline" instead of "+1 chars"
- ✅ **Unified Text Formatting**: Consistent formatting across all node displays and diff summaries
- ✅ **Reset Button Icon**: Updated reset button to use cleaning sponge emoji (🧽) for better visual representation
- ✅ **Function Conflicts Resolution**: Resolved conflicts between generateDiffSummary and formatTextForNodeDisplay functions

### 0.2.12

**Reset & Reload Functionality:**
- ✅ **Reset Button**: Added reset button to start fresh tree from current document state
- ✅ **Complete Tree Reset**: Clears all history and tracking, creates new tree with current content
- ✅ **Reload Timestamp Updates**: Fixed reload button to properly recalculate relative timestamps
- ✅ **Improved Toolbar**: Two-button toolbar with reload and reset functionality

### 0.2.11

**Manual Refresh Capability:**
- ✅ **Reload Button**: Added a reload button to the tree visualization toolbar
- ✅ **Manual Tree Refresh**: Users can now manually refresh the tree view if needed
- ✅ **Theme-Aware Button Styling**: Reload button follows VS Code theme colors and hover states

### 0.2.10

**Improved Change Detection:**
- ✅ **Better Change Type Detection**: Enhanced handling of replacement operations (select + type)
- ✅ **Precise Cursor Position Analysis**: Fixed distance calculation for grouping decisions
- ✅ **Conservative Grouping Logic**: Stricter rules to prevent inappropriate grouping of different action types

### 0.2.9

**Action-Based History:**
- ✅ **Intelligent Change Grouping**: Replaced time-based debouncing with action-based grouping
- ✅ **Smart Change Detection**: Groups changes based on user intent rather than arbitrary time delays
- ✅ **Natural Edit Boundaries**: Creates new history nodes at logical breakpoints

### 0.2.8

**Theme Integration:**
- ✅ **Theme-Aware Styling**: Tree visualization now adapts to VS Code's current color theme
- ✅ **Dynamic Color Integration**: Automatically uses theme colors for nodes, edges, and background
- ✅ **Automatic Theme Updates**: Visualization updates instantly when switching between light/dark themes

### 0.2.7

**Major UX Improvements:**
- ✅ **Fixed Character-by-Character Undo**: Implemented debounced change tracking (1 second delay) to group keystrokes into logical editing units, matching VS Code's default undo behavior
- ✅ **Cursor Position Preservation**: Added cursor position tracking and restoration during undo/redo operations - cursor now stays in the correct position after undo/redo
- ✅ **Smart Change Detection**: Only creates new tree nodes for meaningful changes, reducing tree bloat from rapid typing
- ✅ **Enhanced TreeNode Structure**: Added cursor position storage to each tree node for accurate position restoration
- ✅ **Better Undo Granularity**: Users can now type "asdasdasd" and undo it as a single unit, just like VS Code's default behavior

### 0.2.6

**Enhanced Timestamp Functionality:**
- ✅ **Time Since Now Display**: Added timestamp functionality showing "time since now" above commit hash in visualization bubbles
- ✅ **Smart Time Formatting**: Displays relative time as "X days/hours/minutes/seconds ago" or "Just now" for recent changes
- ✅ **Consistent Visualization**: Both initial visualization creation and updates now use the same timestamp format
- ✅ **Enhanced Node Labels**: Node bubbles now show format: "timeAgo\nshortHash\naddedTextPreview" for better context
- ✅ **Improved Tooltips**: Tooltips display timestamp information along with commit details

### 0.2.5

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
- [Vim UndoTree Plugin](https://github.com/mbbill/undotree)
- [VS Code Extension API](https://code.visualstudio.com/api)

---

**Enjoy enhanced undo/redo with CtrlZTree! 🌳**
