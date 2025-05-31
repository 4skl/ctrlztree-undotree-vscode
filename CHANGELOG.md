# Change Log

All notable changes to the "ctrlztree" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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