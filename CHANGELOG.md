# Change Log

All notable changes to the "ctrlztree" extension will be documented in this file.

## [0.4.0] - 2025-11-12

### Added
- **Diff View Integration**: Integrated diff indicator appears directly in selected nodes
  - Click any node to select it - nodes with parents show a diff indicator in their label
  - Selected nodes display "[📊 Click here for diff]" text directly in the node
  - Click the bottom area of a selected node to open a side-by-side diff view
  - Diff view shows changes between parent node and selected node
  - Uses VS Code's native diff viewer with syntax highlighting
  - Diff view opens beside the graph view (not replacing it)
  - Diff documents are not tracked by the extension to prevent circular tracking issues
- **Read-Only Document Handling**: Read-only editors (like diff views) are now properly excluded from tracking
  - When a read-only document is active, the tree view shows the last valid editor's history
  - Prevents bugs from tracking internal VS Code views

### Enhanced
- **Improved Node Interaction**: Cleaner interface with diff indicator integrated directly in node label
- **Better User Experience**: No floating elements - diff option appears as part of the selected node
- **Smart View Management**: Diff opens in a separate column, preserving the tree visualization
- **Enhanced Tooltips**: Tooltips mention diff functionality for nodes with parents
- **Automatic Positioning**: Diff indicator is part of the node - no manual position calculations needed
- **Responsive Design**: Node labels dynamically update on selection/deselection

### Technical Details
- Added `ctrlztree-diff` URI scheme for virtual diff documents
- Implemented `TextDocumentContentProvider` for diff content
- Selection-based UI with `selectNode` and `deselectNode` event handlers
- Dynamic node label updates to show/hide diff indicator
- Click area detection using bounding box for diff activation (bottom 30% of selected node)
- Added document scheme filtering for read-only documents
- Track last valid editor URI to maintain tree view when switching to read-only documents
- Diff view opens with `ViewColumn.Beside` to avoid replacing graph panel
- Stores base label for each node to enable clean label restoration
- Skips tracking for common read-only schemes: vscode, output, debug, git, search-editor
- Diff view opens with `ViewColumn.Beside` to avoid replacing graph panel

## [0.3.5] - 2025-07-27

### Fixed
- **Webview Disposal Error**: Fixed "Webview is disposed" error that occurred when trying to interact with closed panels
  - Added proper panel validity checks before webview operations
  - Implemented safe message posting with error handling
  - Automatic cleanup of disposed panels from tracking maps
  - Enhanced error logging for better debugging

### Enhanced
- **Improved Panel Management**: Better handling of disposed webview panels
  - Safe webview interaction with validity checks
  - Automatic removal of invalid panels during operations
  - More robust error handling for webview operations
  - Better logging for panel lifecycle events

### Technical Details
- Added `isPanelValid()` helper function to check panel disposal status
- Added `safePostMessage()` helper function for safe webview communication
- Updated all webview interactions to use safe methods
- Enhanced disposal cleanup in theme changes and editor switches
- Improved error handling with try-catch blocks around webview operations

## [0.3.4] - 2025-07-27

### Added
- **Dynamic Tree View**: Tree view now automatically adapts when switching between editor tabs
  - Tree view updates in real-time when user changes active editor
  - Automatically shows history tree for the currently focused file
  - Seamless switching between different files' undo/redo histories
  - Existing panels are reused and updated instead of creating multiple panels

### Enhanced
- **Improved Multi-Document Support**: Better handling of multiple open files
  - Single tree view panel that dynamically shows the appropriate history
  - Panel title updates to reflect the current file name
  - Reduced memory usage by reusing webview panels
  - Better user experience when working with multiple files simultaneously

### Technical Details
- Added `onDidChangeActiveTextEditor` event listener for active editor change detection
- Enhanced panel management to reuse existing webview panels for different documents
- Improved panel title updating to reflect current active file
- Added intelligent panel mapping and cleanup for better resource management

## [0.3.3] - 2025-07-27

### Fixed
- **Tree Orientation**: Fixed horizontal tree layout issue by removing explicit level assignments that were interfering with natural tree hierarchy
  - Removed forced level positioning that was causing all non-current nodes to appear on same level
  - Tree now displays vertically as intended while maintaining current node prominence
- **Production Deployment**: Fixed critical issue where extension didn't work in production due to CDN dependency
  - Replaced remote vis-network CDN with locally bundled library
  - Added vis-network as local dependency and included in extension package
  - Updated Content Security Policy to work with local resources only
- **Current Node Visibility**: Enhanced current node prominence with improved visual styling
  - Increased font size from 14 to 16 for current node
  - Enhanced border thickness from 3 to 4 pixels
  - Added shadow/glow effect to current node for better visibility

### Enhanced
- **Resource Management**: Improved extension resource handling for better offline functionality
  - All required libraries now bundled locally within extension
  - No external network dependencies required for core functionality
- **Build Configuration**: Updated TypeScript configuration to include DOM types for better library compatibility

### Technical Details
- Bundled vis-network.min.js locally in resources folder
- Updated webview creation to include local resource roots
- Modified getWebviewContent to use webview.asWebviewUri for local resources
- Enhanced tsconfig.json with DOM lib for proper type support
- Removed explicit level assignments that were breaking tree hierarchy
- Enhanced current node styling with shadow effects and larger border

## [0.3.2] - 2025-07-25

### Enhanced
- **Documentation Update**: Updated README.md to reflect all features and changes through version 0.3.1
- **Comprehensive Feature Documentation**: Added documentation for all recent features including alternative keybindings, smart empty file undo, and current node prominence
- **Release Notes Synchronization**: Synchronized README with CHANGELOG for consistent documentation

### Technical Details
- Updated README.md with complete feature list and release history
- Added documentation for smart empty file undo behavior
- Enhanced feature descriptions for better user understanding

## [0.3.1] - 2025-07-25

### Added
- **Alternative Redo Keybinding**: Added Ctrl+Shift+Z (Cmd+Shift+Z on Mac) as alternative to Ctrl+Y for redo operations
  - Matches common editor behavior where Ctrl+Shift+Z acts as redo
  - Both Ctrl+Y and Ctrl+Shift+Z now work for redo functionality
- **Smart Empty File Undo**: Enhanced undo behavior for empty files
  - When file is empty and Ctrl+Z is pressed, jumps to the latest non-empty state in history
  - Prevents getting stuck in empty states when undoing from an empty file
  - Falls back to regular undo if no non-empty states are found

### Enhanced
- **Improved Undo Logic**: Better handling of edge cases in undo operations
- **User Experience**: More intuitive behavior when working with empty files and multiple keybinding preferences
- **Current Node Prominence**: The active/current node now appears visually prominent in the tree view
  - Current node is positioned at the top level of the hierarchy 
  - Enhanced visual styling with larger, bold text and thicker border
  - Makes it easier to identify which state you're currently viewing

### Technical Details
- Added `findLatestNonEmptyState()` method to locate most recent non-empty content
- Added `zToLatestNonEmpty()` method for special empty-file undo behavior
- Enhanced undo command with smart content detection and conditional logic
- Added third keybinding entry for Ctrl+Shift+Z redo support
- Enhanced tree visualization with hierarchical positioning for current node
- Improved node styling with dynamic font size, bold text, and border thickness for active node
- Fixed diff display to show both additions and removals for complete change visibility

## [0.3.0] - 2025-07-25

### Enhanced
- **Improved Text Formatting**: Implemented middle ellipsis display for long text content
  - Shows first 37 characters, then "...", then last 37 characters for better readability
  - Unified text formatting across all node displays and diff summaries
- **Smart Diff Summaries**: Enhanced diff summary logic for better change reporting
  - Shows net changes instead of separate additions/deletions (e.g., "+2 lines, +50 chars" instead of "+3 lines -1 lines")
  - Detects pure newline changes and displays as "+1 newline" instead of "+1 chars"
  - Distinguishes between content changes and whitespace-only changes
  - Proper handling of both Unix (\n) and Windows (\r\n) line endings
- **Reset Button Icon**: Updated reset button to use cleaning sponge emoji (🧽) for better visual representation

### Fixed
- **Function Conflicts**: Resolved conflicts between generateDiffSummary and formatTextForNodeDisplay functions
- **Duplicate Ellipsis**: Fixed issue where ellipsis ("...") appeared multiple times in text formatting
- **Character Counting**: Improved accuracy of character and whitespace counting in diff analysis

### Technical Details
- Consolidated text formatting logic into unified functions
- Enhanced generateDiffSummary with intelligent change detection
- Better handling of edge cases in text content analysis
- Improved middle ellipsis formatting for multi-line content display

## [0.2.12] - 2025-07-25

### Added
- **Reset Button**: Added reset button (🔄 Reset) to start fresh tree from current document state
- **Complete Tree Reset**: Clears all history and tracking, creates new tree with current content

### Fixed
- **Reload Timestamp Updates**: Fixed reload button to properly recalculate relative timestamps ("X minutes ago")
- **Proper State Cleanup**: Reset functionality clears all tracking maps and timeouts for clean start

### Enhanced
- **Improved Toolbar**: Two-button toolbar with reload and reset functionality
- **Better Button Styling**: Consistent button styling with hover states and visual differentiation
- **State Management**: Better handling of document state transitions and cleanup

### Technical Details
- Reset button removes existing tree and creates fresh CtrlZTree instance
- Clears lastChangeTime, lastCursorPosition, lastChangeType, and pendingChanges maps
- Cancels any pending timeouts for the document
- Reload button now properly regenerates timestamps by calling postUpdatesToWebview

## [0.2.11] - 2025-07-25

### Added
- **Reload Button**: Added a reload button (🔄) to the tree visualization toolbar
- **Manual Tree Refresh**: Users can now manually refresh the tree view if needed
- **Theme-Aware Button Styling**: Reload button follows VS Code theme colors and hover states

### Enhanced
- **Better Error Recovery**: Reload functionality helps recover from visualization issues
- **Improved UX**: Easy access to tree refresh without closing and reopening the panel

### Technical Details
- Added fixed-position toolbar with reload button in top-right corner
- Implemented `requestTreeReload` message handling between webview and extension
- Added proper error handling and logging for reload operations

## [0.2.10] - 2025-07-25

### Fixed
- **Improved Change Type Detection**: Better handling of replacement operations (select + type)
- **More Precise Cursor Position Analysis**: Fixed flawed distance calculation for grouping decisions
- **Conservative Grouping Logic**: Stricter rules to prevent inappropriate grouping of different action types
- **Enhanced Position Logic**: Separate handling for same-line vs multi-line cursor movements

### Technical Details
- Fixed change type detection to treat same-length replacements as 'typing' operations
- Improved cursor position analysis with separate thresholds for line vs character differences
- Removed permissive grouping of 'other' change types for more predictable behavior
- Added enhanced debugging output with cursor position tracking

## [0.2.9] - 2025-07-25

### Enhanced
- **Action-Based History**: Replaced time-based debouncing with intelligent action-based grouping
- **Smart Change Detection**: Groups changes based on user intent rather than arbitrary time delays
- **Natural Edit Boundaries**: Creates new history nodes at logical breakpoints (cursor movement, change type switches, long pauses)
- **Improved Granularity**: Better balance between too many micro-changes and overly grouped changes

### Technical Details
- Implemented action-based change grouping algorithm that considers:
  - Change type (typing vs deletion vs other)
  - Cursor position continuity
  - Time gaps between changes (1.5s threshold for forced breaks)
  - Edit locality (prevents grouping distant changes)
- Reduced timeout for grouped changes to 500ms, ungrouped changes to 50ms
- Added change type detection and cursor position tracking
- Enhanced debugging output for change grouping decisions

## [0.2.8] - 2025-07-25

### Enhanced
- **Theme-Aware Styling**: Tree visualization now adapts to VS Code's current color theme
- **Dynamic Color Integration**: Automatically uses theme colors for nodes, edges, and background
- **Better Visual Integration**: Extension now feels native to VS Code's interface
- **Automatic Theme Updates**: Visualization updates instantly when switching between light/dark themes

### Technical Details
- Implemented CSS custom properties integration with VS Code's theming system
- Added theme change detection and dynamic color computation
- Enhanced webview styling with proper theme variable usage

## [0.2.7] - 2025-07-24

### Fixed
- **Character-by-Character Undo Issue**: Implemented debounced change tracking with 1-second delay to group keystrokes into logical editing units
- **Lost Cursor Position**: Added cursor position tracking and restoration during undo/redo operations
- **Undo Granularity**: Now matches VS Code's default behavior - typing "asdasdasd" and pressing Ctrl+Z removes the entire text, not character by character

### Enhanced
- **Smart Change Detection**: Only creates new tree nodes for meaningful changes, reducing unnecessary tree bloat
- **Enhanced TreeNode Structure**: Added `cursorPosition` field to store cursor position at each state
- **Better UX**: Undo/redo now behaves more like users expect from a text editor

### Technical Details
- Added debouncing mechanism for document changes to prevent excessive tree node creation
- Implemented cursor position preservation across all undo/redo operations including webview navigation
- Enhanced `CtrlZTree.set()` method to accept cursor position parameter
- Added `getCursorPosition()` method to retrieve stored cursor positions
- Added proper cleanup of pending timeouts in deactivate function
- Improved change detection to only process meaningful document differences

## [0.2.6] - 2025-06-05

### Enhanced
- **Timestamp Functionality**: Added "time since now" display above commit hash in visualization bubbles
- **Smart Time Formatting**: Shows relative time as "X days/hours/minutes/seconds ago" or "Just now" for recent changes
- **Consistent Visualization**: Both initial visualization creation and live updates now use identical timestamp formatting
- **Enhanced Node Display**: Node bubbles show format "timeAgo\nshortHash\naddedTextPreview" for comprehensive context
- **Improved User Experience**: Users can now easily see when each change was made relative to the current time

### Technical Details
- Added `timestamp` field to TreeNode interface with Unix timestamp tracking
- Implemented `formatTimeAgo()` helper function for human-readable time conversion
- Updated both `showVisualizationForDocument()` and `postUpdatesToWebview()` to use consistent timestamp formatting
- Enhanced node labels and tooltips to include temporal context alongside commit information
- Removed unused `getDiffPreview()` function to clean up codebase

## [0.2.5] - 2025-06-05

### Enhanced
- **Improved Visualization**: Enhanced node labels in the tree visualization to show both commit ID and added text
- **Better Node Display**: Clickable bubbles now display the commit hash on the first line and new text added on the second line
- **User Experience**: Made it easier to see what content was added at each commit directly in the visual tree nodes

### Technical Details
- Modified node label generation to include both short hash and added text preview
- Updated tooltip generation to focus on added content rather than full diff
- Improved readability of the visual tree by showing meaningful content in each node

## [0.2.4] - 2025-06-05

### Enhanced
- **Package Metadata**: Enhanced package.json with better description and keywords for improved discoverability
- **Documentation**: Updated package metadata to reference the Undotree plugin inspiration
- **Keywords**: Added comprehensive keywords including "vscode", "extension", "undotree", "history", "tree", "ctrlz"

### Technical Details
- Improved package.json metadata for better marketplace presentation
- Enhanced project description to better communicate functionality
- Added relevant keywords for improved search discoverability

## [0.2.3] - 2025-06-05

### Fixed
- Fixed an algorithmic bug in the Longest Common Subsequence (LCS) implementation in `lcs.ts`.

## [0.2.2] - 2025-05-31

### Fixed
- **Repository URL**: Updated package.json repository URL to point to the correct dedicated repository: `https://github.com/4skl/ctrlztree-undotree-vscode.git`
- **Project Organization**: Fixed repository reference to use the specific VS Code extension repository instead of the general CtrlZTree project

## [0.2.1] - 2025-05-31

### Maintenance
- **Code Cleanup**: Removed unused `lcs_new.ts` file that was not being imported or used
- Cleaned up project structure by removing redundant files
- No functional changes - purely maintenance release

## [0.2.0] - 2025-05-31

### Enhanced
- **Enhanced Tooltip Content**: Tooltips now show only the changed lines from diffs instead of full content
- Improved readability by displaying only the relevant `+` (added) and `-` (removed) lines
- Limited tooltip display to 15 changed lines maximum to prevent overwhelming UI
- Better focus on what actually changed at each node in the tree

### Added
- Smart extraction of changed lines from git-style diffs for tooltip display
- Automatic truncation with "more changes" indicator for large diffs
- Enhanced tooltip format showing only the relevant diff content

### Technical Details
- Modified `getDiffPreview()` function to extract only `+` and `-` lines from diff summaries
- Added intelligent line limiting (15 lines max) for tooltip readability
- Improved user experience by focusing on actual changes rather than full content
- Maintained git-style diff format for consistency

## [0.1.9] - 2025-05-31

### Enhanced
- **Git-Style Diff Display**: Replaced character-level diff previews with readable git-style text diffs
- Enhanced tooltip previews now show line-based changes with `+` (added) and `-` (removed) indicators
- Branch selection dialog displays meaningful diff summaries instead of raw content previews
- Improved readability when viewing change history in the tree visualization

### Added
- New `generateUnifiedDiff()` function for full git-style unified diff output
- New `generateDiffSummary()` function for concise diff summaries suitable for tooltips
- New `generateLineDiff()` function for line-based diff operations
- Helper functions `groupIntoHunks()` for organizing diff changes into readable sections

### Technical Details
- Enhanced `lcs.ts` with 6 new git-style diff generation functions
- Updated `extension.ts` to use `generateDiffSummary()` instead of character-based previews
- Improved tooltip format to display changes in git-like format with line context
- Better user experience when selecting branches or viewing change previews

## [0.1.8] - 2025-05-31

### Fixed
- **Documentation Fix**: Corrected corrupted CHANGELOG.md file
- Properly documented all previous versions including the critical v0.1.7 LCS bug fix
- Restored proper changelog formatting and structure

### Technical Details
- Fixed duplicate content and missing entries in CHANGELOG.md
- Ensured all version history is properly documented
- Maintained proper markdown formatting for better readability

## [0.1.7] - 2025-05-31

### Fixed
- **Critical Bug Fix**: Replaced buggy LCS implementation with working version
- Fixed "Maximum call stack size exceeded" error caused by reconstruction bugs in diff algorithm
- Improved diff reconstruction reliability and performance
- Fixed TypeScript compilation errors with proper brace formatting

### Technical Details
- Replaced current `src/lcs.ts` with previously working `lcs_new.ts` implementation
- Fixed conditional statements to use proper braces for TypeScript compliance
- Removed backup files and cleaned up temporary implementations
- The diff algorithm now correctly reconstructs content without infinite loops

## [0.1.6] - 2025-05-31

### Changed
- **Final Cleanup**: Removed temporary test file `test_diff_efficiency.js`
- Extension package is now completely clean with only production files
- Reduced package size further by removing development artifacts

### Technical Details
- Removed `test_diff_efficiency.js` which was used for testing the diff optimization
- Package now contains only essential files for the extension functionality

## [0.1.5] - 2025-05-31

### Changed
- **Code Cleanup**: Removed unused LCS implementation files
- Cleaned up both source (`src/lcs_new.ts`) and compiled (`out/lcs_old.js`, `out/lcs_new.js`) files
- Extension now uses only the optimized character-based diff implementation

### Technical Details
- Removed duplicate and legacy LCS files to reduce package size
- Kept only `src/lcs.ts` and `out/lcs.js` which contain the active implementation
- Cleaner codebase with no unused files

## [0.1.5] - 2025-01-31

### Changed
- **Code Cleanup**: Removed unused LCS implementation files
- Cleaned up both source (`src/lcs_new.ts`) and compiled (`out/lcs_old.js`, `out/lcs_new.js`) files
- Extension now uses only the optimized character-based diff implementation

### Technical Details
- Removed duplicate and legacy LCS files to reduce package size
- Kept only `src/lcs.ts` and `out/lcs.js` which contain the active implementation
- Cleaner codebase with no unused files

## [0.1.4] - 2025-01-31

### Changed
- **Enhanced Tooltips**: Node tooltips now show only the modified part (changes) instead of full content
- Tooltips display added content with `+` prefix and removed content as `-X chars`
- More concise and focused information when hovering over nodes in the tree visualization

### Technical Details
- Added `getDiffPreview()` function to extract meaningful changes from diff operations
- Shows actual added text content and count of removed characters
- Handles parse errors gracefully with informative error messages

## [0.1.3] - 2025-01-31

### Changed
- **MAJOR OPTIMIZATION**: Implemented debouncing for document changes to prevent excessive node creation
- Document changes are now grouped together with a 1-second delay, dramatically reducing tree size
- Only creates new nodes after user pauses typing, not on every keystroke

### Fixed
- Fixed performance issues caused by creating a new tree node for every character typed
- Reduced memory usage and improved extension responsiveness
- Eliminated tree bloat from rapid sequential edits

### Technical Details
- Added debouncing mechanism with 1000ms delay for change processing
- Improved change detection to batch related edits together
- Enhanced cleanup in extension deactivation

## [0.1.2] - 2025-01-31

### Fixed
- Fixed "Maximum call stack size exceeded" error caused by recursive document change events
- Added robust safeguards to prevent infinite loops in the onDidChangeTextDocument handler
- Improved document processing logic to avoid redundant tree updates

### Changed
- Enhanced change detection to only process document updates when content actually differs from tree state
- Added per-document processing tracking to prevent recursive calls

## [0.1.1] - 2025-01-31

### Added
- Enhanced node tooltips now show the actual modified text content
- Content preview in tooltips (first 100 characters with line breaks shown as ⏎)
- Better visual feedback when hovering over nodes in the tree visualization

### Changed
- Improved tooltip format: shows both hash and content preview
- Line breaks in content preview are displayed as ⏎ symbol for better readability

## [0.1.0] - 2025-01-31

### Added
- Initial release
- Tree-based undo/redo functionality
- Visual tree representation with interactive navigation
- Custom keybindings for Ctrl+Z and Ctrl+Y
- Real-time history tracking
- Branch selection for ambiguous redo operations