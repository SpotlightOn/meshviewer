# Changelog

Notable changes only. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) / [SemVer](https://semver.org/).

## [Unreleased]

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
