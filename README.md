# Meshviewer

Every file manager shows nice thumbnails, so why another app?
I want something that is really fast and easy for browsing my images.
There are still lots of things I'd like to improve, but it's already really good.
It's fast thanks to advanced caching.
Enjoy a modern, old-fashioned photo browser that even supports GLTF 3D scenes.

Have an idea? Open an issue and let's see what we can do.

**Short description:**
Electron application that renders local `*.glb` files as thumbnails (three.js, GLTFLoader). It also supports SVG and most common pixel formats.

![Meshviewer screenshot](./docs/screen.png)


## Install

Release binaries are built for Linux (AppImage), Windows (NSIS installer, portable, ZIP) and macOS (arm64 and x64 DMG).

## Running from sources

```bash
pnpm install
pnpm start
```

Navigate in the directory tree on the left (rooted at `/`); `..` goes one level up, the Home button jumps to the user directory. All found GLB files (including subfolders) are rendered as previews, image files are shown directly. Clicking a tile opens the large view in full window size (3D models can be rotated and zoomed with the mouse); "Back" or `ESC` returns to the list view.

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

Zoom is also controlled with the mouse: the wheel (dolly for 3D models, scale for images) and the zoom slider in the header. The percentage field next to the slider accepts a typed value such as `120` — `Enter` or clicking away applies it, `Esc` reverts the field.

**File grid**

| Shortcut | Action |
| --- | --- |
| `Ctrl` + `+` / `=` | Larger tiles |
| `Ctrl` + `-` | Smaller tiles |
| `Ctrl` + `0` | Reset tile size |

**Directory field**

| Shortcut | Action |
| --- | --- |
| `Enter` | Open the entered path |
| `Esc` | Revert the field |

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
