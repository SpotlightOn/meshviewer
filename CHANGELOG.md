# Changelog

Notable changes only. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) / [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Setting for the background behind transparent images: checkerboard, white or a custom color (fills the grid tile; drawn at image size on a black stage in the large view)
- Setting for the thumbnail fit: cover (fill the tile) or contain (show the whole image)
- Resizable directory tree sidebar: drag the divider (or focus it and use the arrow keys); the width is remembered across restarts
- Multiple selection of thumbnails: Ctrl/Cmd-click toggles, Shift-click selects a range, dragging on empty space draws a rubber-band selection, Ctrl+A selects all and Esc clears the selection
- Copy and paste of files inside the app (Ctrl+C / Ctrl+V or the context menu); a pasted file whose name already exists gets a “(1)” suffix
- Move selected files to the OS trash (Delete key or the context menu); trashed files stay recoverable
- Create a new folder from the context menu of the directory tree or the empty grid area
- Paste the in-app clipboard into the folder chosen in the directory tree or the empty grid area context menu

### Changed
- Default slideshow transition changed to “slide” with a 300 ms animation duration
- Empty state: larger logo without its dark background
- Thumbnail context menu: the file information entry is listed first
- The “New folder” and “Paste” context menu entries are sorted first and apply the action to the chosen folder
- Help menu: “Keyboard shortcuts” is now “Usage” and also documents the mouse gestures such as the middle-click fit toggle and the wheel zoom

### Fixed
- Thumbnails of images smaller than the tile are scaled to fill the tile instead of being shown at natural size, which looked like a transparent border once the transparency background is visible

## [0.5.0] - 2026-10-09

### Added
- File information dialog in the large view (info icon before fullscreen): all EXIF groups of the image, with basic file information (size, dimensions, modified date, type) as fallback
- Actual-size (1:1) button in the large view zoom controls
- Previous/next arrow buttons in the large view status bar to step through the files
- Swiping (drag) horizontally across an image in the large view steps to the previous/next file; the image follows the pointer and snaps back when the drag is too short
- Middle mouse button on an image in the large view toggles between 100 % zoom and fit-to-screen
- Context menu on media thumbnails (right-click): open the file with the default application or show the file information dialog
- Configurable editor command in the settings dialog: the thumbnail context menu gains an “Edit with …” entry that opens the file in the configured application

### Changed
- Large view status bar shows "file name | pixel dimensions | file size" with all text left-aligned
- Empty state shows the app logo and a larger message when a folder has no media files or could not be loaded

### Fixed
- Thumbnails of photos with EXIF orientation (e.g. portrait shots) are no longer shown rotated; the embedded-thumbnail path now applies the orientation tag
- The zoom slider and the zoom input field now zoom the 3D view; previously they updated only the display and left the model at its initial distance
- File information dialog: embedded preview images are displayed as images instead of raw bytes; unreadable binary metadata (maker notes, HDR+ payloads) is hidden

## [0.4.0] - 2026-10-08

### Added
- Zoom slider (10-800 %) with direct percentage entry for the large view
- Keyboard shortcuts dialog in the Help menu
- Close button and Esc to close the About dialog
- Edit menu with undo, redo, cut, copy, paste and select all
- Breadcrumb path bar: every folder in the path is clickable, the path is editable as text (click the active folder or empty space)
- Fit-to-screen button next to the zoom field in the large view
- Slideshow progress line in the large view header (reaches the right edge when the next image appears)
- Fullscreen mode for the large view (header button, exit icon appears while the mouse moves, Esc leaves fullscreen)

### Changed
- Toolbar: Material outline icons for up and home with a clearly visible separator before the path
- Large view slideshow is a switch control with label instead of a button
- Large view back button is an arrow icon with the label as tooltip
- Large view file name and details moved from the header to a status bar at the bottom

### Fixed
- Arrow keys no longer navigate behind the open settings dialog
- Selecting a directory in the tree works with Windows paths (drive letters, forward and backslash separators)
- About and shortcuts dialogs no longer show the application menu bar
- Menu labels are fully translated (no mixed German/English entries)
- Entering a non-existent directory in the path bar reverts to the previous path instead of showing it as empty

## [0.3.0] - 2026-10-07

### Added
- Settings dialog: interval, transition, animation duration (0-5000 ms, default 1000 ms)
- Slideshow with fade/slide transition (header button, F5)
- Windows (NSIS, portable, ZIP) and macOS (arm64, x64 DMG) release binaries

### Changed
- Slide transition follows the navigation direction: forward from the right, backward from the left
- Transitions start only after the new image is decoded and fitted
- Window icon drawn as SVG, PNG/ICO generated from it
- Repository link, release workflow and About dialog point to GitHub

### Fixed
- Slideshow keeps running and the header stays visible while changing images
- Arrow keys, Backspace and Space work while a button in the large view is focused
- Failed or superseded large view loads clean up their frame and WebGL context

## [0.2.0] - 2026-08-12

### Added
- Sharp thumbnail cache with freedesktop and EXIF thumbnail reuse
- Lazy preview loading in the grid
- Directory tree prefetch (one level, bounded concurrency)

### Changed
- Grid lists the current directory instead of recursing
- UI polish

### Fixed
- Directory scanning tolerates permission errors and symlink cycles

## [0.1.0] - 2026-08-11

### Added
- First release: directory tree, thumbnail grid, GLB and image large view, editable path input
- Linux AppImage and source tarball releases
