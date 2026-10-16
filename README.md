# Meshviewer

[![CI](https://github.com/SpotlightOn/meshviewer/actions/workflows/ci.yml/badge.svg)](https://github.com/SpotlightOn/meshviewer/actions/workflows/ci.yml)
[![CodeQL](https://github.com/SpotlightOn/meshviewer/actions/workflows/codeql.yml/badge.svg)](https://github.com/SpotlightOn/meshviewer/actions/workflows/codeql.yml)
[![Latest release](https://img.shields.io/github/v/release/SpotlightOn/meshviewer)](https://github.com/SpotlightOn/meshviewer/releases/latest)
[![License: MIT](https://img.shields.io/github/license/SpotlightOn/meshviewer)](./LICENSE)
[![Socket.dev: monitored](https://img.shields.io/badge/Socket.dev-monitored-34506b?logo=socketdotdev&logoColor=white)](https://github.com/SpotlightOn/meshviewer/pulls)

Every file manager shows thumbnails, so why build another app?
I wanted a photo browser that’s fast and easy to use.

I also have lots of 360° photos from Google Photos and my DJI drone, but I couldn’t find a free image viewer that supported equirectangular images. I work with 3D scenes, too, and couldn’t find a simple viewer for GLB models.

There’s still plenty I’d like to improve, but it’s already working really well—and advanced caching keeps it speedy.
Enjoy a modern photo browser with an old-fashioned feel—and a real 3D viewer. Open GLB models as interactive Three.js scenes you can rotate, pan, and zoom from any angle.

Have an idea? Open an issue, and let’s see what we can do.

Short description:
An Electron app that renders local .glb files as thumbnails using Three.js and GLTFLoader, displays 360° panoramas, and supports SVGs and most common image formats.

[<img src="./docs/screen.png" alt="Meshviewer screenshot" width="45%" />](./docs/screen.png) [<img src="./docs/screen2.png" alt="Meshviewer screenshot 2" width="45%" />](./docs/screen2.png)

![Panorama demo](./docs/image360.gif)

## Features

- **3D models (`.glb`)** — grid thumbnails rendered with three.js/GLTFLoader; the large view is an interactive scene (orbit, pan, zoom)
- **360° panoramas** — equirectangular photos get a panorama mode: drag to look around, the wheel or the zoom slider changes the field of view
- **Many image formats** — PNG, JPEG, GIF, WebP, AVIF, BMP, SVG and ICO
- **Fast thumbnails** — 256 px JPEGs from `sharp`, reusing the freedesktop thumbnail cache and embedded EXIF thumbnails; loaded lazily as they scroll into view, with EXIF orientation applied
- **Folder tiles** — subdirectories are listed first, each tile showing the folder's first image inside a folder-shaped frame
- **Directory tree** — rooted at `/`, children loaded lazily with a bounded prefetch, resizable sidebar with a remembered width
- **Multi-selection** — Ctrl/Cmd-click toggles, Shift-click selects a range, rubber-band drag over empty space, Ctrl+A selects all, Esc clears
- **File operations** — copy, cut, paste, move to trash, create and delete folders, optional checksum verification for moves
- **Context menus** — open with the default application, edit with a configurable editor command, file information, new folder, paste
- **Large view** — keyboard navigation, previous/next arrows, horizontal swipe, middle-click toggles 100 %/fit, zoom slider 10–800 % with typed values, fit-to-screen and 1:1 buttons, fullscreen, status bar with name, dimensions and size
- **Slideshow** — fade or slide transition with configurable interval and animation duration, progress line in the header
- **File information dialog** — all EXIF groups of an image plus basic file information, with the embedded preview shown as an image
- **Lossless JPEG rotation** — rotate left/right in the large view rewrites `.jpg`/`.jpeg` in place without recompressing; EXIF and the other markers survive, and it runs in-process through the bundled `@chimok/jpegtran-js` WebAssembly module
- **Lossless JPEG crop** — a crop mode in the large view whose selection snaps to the iMCU grid of the file, so the result is exactly the area that was picked; it is written as `<name>-crop-<n>.jpg` next to the source, which stays untouched
- **Path bar** — clickable breadcrumbs that switch to an editable text field
- **Settings** — color scheme, tile open behavior, thumbnail fit, transparency background, editor command, slideshow, checksum verification

## Install

Release binaries are built for Linux (AppImage), Windows (NSIS installer, portable, ZIP) and macOS (arm64 and x64 DMG).

## Running from sources

```bash
pnpm install
pnpm start
```

Navigate in the directory tree on the left (rooted at `/`); `..` goes one level up, the Home button jumps to the user directory. All found GLB files (including subfolders) are rendered as previews, image files are shown directly. Subdirectories appear as folder tiles before the media files; each shows the folder's first image inside a folder-shaped frame, so it stays recognisable as a directory at a glance (folders without images keep the empty folder shape). Double-clicking a tile opens the large view in full window size (a single click only selects it; the “File operations” setting can switch the grid to single-click opening); `Enter` opens the selected tile from the keyboard. 3D models can be rotated and zoomed with the mouse; the back arrow in the header ("Back" tooltip) or `ESC` returns to the list view. The file name and its details are shown in the status bar at the bottom. The fullscreen button switches the window to fullscreen mode: the header and status bar hide, moving the mouse reveals the exit icon, and `ESC` leaves fullscreen first.

## Keyboard shortcuts

**Large view**

| Shortcut | Action |
| --- | --- |
| `←` / `Backspace` | Previous file |
| `→` / `Space` | Next file |
| `F` | Toggle fit / original size (images) |
| `Ctrl` + `+` / `=` | Zoom in |
| `Ctrl` + `-` | Zoom out |
| `Ctrl` + `0` / `1` | Reset zoom to 100 % |
| `F5` | Start / stop the slideshow |
| `Esc` | Close the large view |
| `F11` | Toggle fullscreen |

Zoom is also controlled with the mouse: the wheel (dolly for 3D models, scale for images) and the zoom slider in the header. The percentage field next to the slider accepts a typed value such as `120` — `Enter` or clicking away applies it, `Esc` reverts the field. The fit-to-screen button beside it restores the fitted size after zooming, and the slideshow is toggled with a switch in the header; while it runs, a subtle 1 px progress line at the header's bottom edge shows the time until the next image.

**Crop mode (JPEG)**

| Shortcut | Action |
| --- | --- |
| `←` / `→` / `↑` / `↓` | Move the selection by one grid step |
| `Shift` + arrows | Resize the selection |
| `R` | Select the whole image again |
| `Enter` | Write the crop as a new file |
| `Esc` | Leave the crop mode |

**File grid**

| Shortcut | Action |
| --- | --- |
| `Ctrl` + `+` / `=` | Larger tiles |
| `Ctrl` + `-` | Smaller tiles |
| `Ctrl` + `0` | Reset tile size |
| `Ctrl` + mouse wheel | Zoom tiles in / out |
| `Enter` | Open the selected tile |

**Path bar**

| Shortcut | Action |
| --- | --- |
| `Enter` | Open the entered path |
| `Esc` | Revert the field |

The path bar shows the current directory as clickable breadcrumbs: clicking a
folder jumps to it, clicking the current folder or the empty space switches to
an editable text field (so a path can be typed or pasted, e.g. with
`Ctrl` + `V`).

## Supported Formats

- **3D models**: `*.glb` (GLTF Binary), rendered with three.js/GLTFLoader
- **Images**: `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.avif`, `*.bmp`, `*.svg`, `*.ico`

Image formats are decoded directly by the Chromium/Electron image decoder; additional formats (e.g. HEIC/HEIF or JPEG XL) are not supported by Electron on Linux/Windows.

## Localization

The UI is English by default; German is provided as a translation via i18next. The language follows the system locale (`app.getLocale()`). Pull requests for new translations are welcome.

## Structure

- `src/main.js` – Main process: custom protocol `app://`, filesystem IPC, CSP header
- `src/preload.js` – secure API bridge (`contextBridge`)
- `src/renderer/` – UI with three.js thumbnail rendering
