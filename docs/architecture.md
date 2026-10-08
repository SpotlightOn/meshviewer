# MeshViewer — Architecture

MeshViewer is an Electron application that shows local media files as a browsable
grid: `*.glb` models are rendered to thumbnails with three.js, images are shown
from a generated or embedded thumbnail. Selecting an item opens a large view with
keyboard navigation and a slideshow.

It is plain JavaScript — no framework, no bundler. The whole app runs as ES
modules (`"type": "module"` in `package.json`): the main process is ESM, the
renderer loads ES modules directly through a custom `app://` protocol. The only
CommonJS files are the sandboxed preloads (`src/preload.js`,
`src/dialogPreload.js`) — sandboxed preload scripts always run as CommonJS, so
they cannot be ESM.

## Process model

```
┌──────────────────────────── Electron main process (ESM) ─────────────────────┐
│ src/main.js        entry: app lifecycle, i18next init, module wiring         │
│ src/protocol.js    app:// protocol handler (CSP, MIME map, path routing)      │
│ src/main-window.js main BrowserWindow (preload, icon)                         │
│ src/menu.js        application menu (Edit roles, Help → dialogs)              │
│ src/dialogs.js     About + shortcuts dialogs, dialog:close IPC                │
│ src/fsIpc.js       filesystem IPC handlers (fs:*)                             │
│ src/thumbnails.js  thumbnail cache (sharp, freedesktop, EXIF)                 │
│ src/settingsStore.js  settings.json in userData (settings:*)                  │
└───────────────▲──────────────────────────────────────────────▲────────────────┘
                │ ipcRenderer.invoke / handle                  │ protocol.handle
┌───────────────┴───────────────┐   ┌──────────────────────────┴───────────────┐
│ src/preload.js (CommonJS)     │   │ Renderer (src/renderer/, ES modules)     │
│ contextBridge → window.api    │   │ index.html, renderer.js (entry), tree.js,│
│ contextIsolation: true        │   │ grid.js, large-view.js, settings.js,     │
│ nodeIntegration: false        │   │ keyboard.js, three-utils.js, i18n.js,    │
│                               │   │ utils.js, styles.css                     │
│                               │   │ three.js + vendored GLTFLoader           │
└───────────────────────────────┘   └──────────────────────────────────────────┘
```

- The renderer never touches Node or the filesystem directly. Everything goes
  through the typed `window.api` surface declared in `src/preload.js`.
- The preload exposes one function per IPC channel and returns promises; there is
  no generic `invoke(channel, …)` escape hatch.

## Module map

| File | Responsibility |
| --- | --- |
| `src/main.js` | Entry: app lifecycle, i18next init, wires all modules together |
| `src/protocol.js` | Custom `app://` protocol: CSP header, MIME map, path routing (renderer root, `node_modules`, `locales`) |
| `src/main-window.js` | Creates the main `BrowserWindow` (sandboxed preload, window icon) |
| `src/menu.js` | Application menu with fully i18n labels (Edit roles, Help → dialogs) |
| `src/dialogs.js` | About + shortcuts dialogs without a menu bar (plain windows), `dialog:close` IPC |
| `src/fsIpc.js` | `fs:*` handlers: directory listing, media filtering, file reads, locale, `shell:openPath` |
| `src/thumbnails.js` | Thumbnail generation and cache lookup; returns `null` when generation is impossible |
| `src/settingsStore.js` | Loads/validates/persists `settings.json`, registers `settings:*` handlers |
| `src/preload.js` | `contextBridge` API (`window.api`), typed via JSDoc `@typedef` |
| `src/dialogPreload.js` | About and shortcuts dialogs: Close button and Esc send `dialog:close` |
| `src/renderer/renderer.js` | Entry: wires tree/grid/settings/keyboard, directory field, boot |
| `src/renderer/tree.js` | Lazy directory tree with a bounded lookahead task queue |
| `src/renderer/grid.js` | Media grid: folder loading, cards, image/GLB thumbnails |
| `src/renderer/large-view.js` | Image/GLB large view: zoom, navigation, slideshow |
| `src/renderer/settings.js` | Settings dialog, persistence and `onSaved` callback |
| `src/renderer/keyboard.js` | Global shortcuts (F11, settings Esc, grid zoom) |
| `src/renderer/three-utils.js` | Shared three.js helpers (`disposeObject`) |
| `src/renderer/i18n.js` | i18next init, `t()`, `data-i18n` attribute translation |
| `src/renderer/utils.js` | Pure helpers: file size formatting, MIME detection, `ArrayBuffer` conversion |
| `src/renderer/vendor/` | Pinned three.js add-ons (GLTFLoader, OrbitControls, …) |

Pure, Electron-independent logic lives in `fsIpc.js`, `settingsStore.js`,
`thumbnails.js` and `renderer/utils.js` so it can be unit-tested without
launching the app.

## IPC surface

| Channel | Direction | Purpose |
| --- | --- | --- |
| `fs:listMediaFiles` | renderer → main | Media files of one directory (non-recursive) |
| `fs:listDirectories` | renderer → main | Child directories for the tree |
| `fs:homeDir` / `fs:cwd` / `fs:rootDir` / `fs:parentDir` | renderer → main | Path navigation |
| `fs:locale` | renderer → main | System locale (BCP-47) for i18n |
| `fs:readFile` | renderer → main | File content as `ArrayBuffer` |
| `fs:getThumbnail` | renderer → main | Cached/generated JPEG data URL, or `null` |
| `shell:openPath` | renderer → main | Open a file with the system handler |
| `settings:get` / `settings:save` | renderer → main | Read/validate/persist settings |
| `menu:open-settings` | main → renderer | Menu event, subscription returns an unsubscribe function |
| `dialog:close` | dialog → main | Close the modal About/shortcuts dialog |

Directory listings are deliberately one level deep: the grid lists the current
directory only, while the tree loads children on demand.

## Thumbnail pipeline

`src/thumbnails.js` resolves an image preview in this order:

1. **Own cache** — `userData/thumbnails/<sha1(path + size + mtimeMs)>.jpg`,
   256 px JPEG produced by `sharp` (N-API, no ABI rebuild on Electron upgrades).
2. **Freedesktop cache** — `~/.cache/thumbnails/` as written by KDE/GNOME/XFCE,
   so an already-indexed image is reused instead of decoded again.
3. **Embedded EXIF thumbnail** — for `.jpg`/`.jpeg`, only the first 1 MB of the
   file is read and the embedded preview extracted with `piexifjs`.
4. **Full decode** — `sharp` reads the whole file.

If `sharp` is unavailable or decoding fails, `null` is returned and the renderer
falls back to displaying the file itself.

GLB thumbnails take a different path: the renderer loads the model with
`GLTFLoader`, renders it once into an off-screen `WebGLRenderer` at 256 px and
disposes the scene afterwards.

## Renderer data flow

```
directory tree (sidebar)          grid (content area)
      │                                │
      │ onSelect(path)                 │ loadFolder(path)
      ▼                                ▼
  setTreeRoot / openPath  ────►  currentFiles[]  ───►  createCard(file)
                                      │                     │
                                      │                     ├─ image  → loadImageThumbnail()
                                      │                     └─ glb    → renderThumbnail()
                                      ▼
                              IntersectionObserver
                              lazy card previews + content-visibility: auto
```

- `createDirectoryTree()` in `tree.js` lazily fetches children per node; a
  `createTaskQueue(4)` bounds concurrency and prefetches exactly one level ahead.
- `renderer.js` is a thin entry: it constructs the modules and wires them through
  injected callbacks (tree `onSelect` → grid `loadFolder`, grid `onOpenFile` →
  large view), so every module stays independently testable.
- Grid cards render only when they approach the viewport, which keeps large
  directories responsive.
- The large view keeps a single token (`largeToken`) so a navigation that
  supersedes an in-flight load can ignore its result.
- Transitions start only when the new content is ready to paint: a navigation
  disposes the previous view's resources first (WebGL context, listeners, object
  URL) but keeps its frames. Images are built detached, decoded and fitted, then
  appended with their `enter-fade`/`enter-slide` class; the GLB renderer canvas
  joins only after the model is parsed. Only at that point `retireLargeFrames()`
  adds a `leave-fade`/`leave-slide` class to the old frame, which is removed once
  its animation ended (with a timeout as safety net). For the slide transition the
  navigation direction decides the direction via the `--slide-dir` custom
  property — forward enters from the right and pushes the old frame out to the
  left, backward does the mirror image.

## Settings

`src/settingsStore.js` normalizes untrusted input against defaults
(`slideshowIntervalSeconds`, `slideshowTransition`, `animationDurationMs`), clamps
the interval to 1–3600 seconds and the animation duration to 0–5000 ms, and rejects
unknown transitions. The duration is applied through the `--transition-duration` CSS
custom property, so the fade/slide animation of the large view follows the setting.
The defaults are a 5 second interval, the fade transition and a 1000 ms animation
duration.
The file lives in `app.getPath('userData')/settings.json`; missing or corrupt files
fall back to defaults instead of failing.

## Internationalization

- Locale comes from the system (`app.getLocale()` → `fs:locale`); anything not
  German falls back to English.
- Main process: i18next drives the menu, the About window and the shortcuts
  dialog.
- Renderer: `i18n.js` initializes i18next and applies `data-i18n` /
  `data-i18n-title` attributes to static markup.
- Translations live in `src/locales/en.json` (default) and `src/locales/de.json`.
  New keys must be added to both files.

## Security posture

- `contextIsolation: true`, `nodeIntegration: false`, preload-only bridge.
- Renderer content is served through `app://` with a CSP header and a MIME map;
  path traversal outside the renderer root is rejected with `403`.
- External links from the About window are forced through `shell.openExternal`.

## Packaging and CI

- electron-builder targets: Linux (AppImage, tar.gz), Windows (nsis, portable,
  zip) and macOS (arm64 and x64 DMG, built on a macOS runner).
- `meshviewer.desktop` is a template: `scripts/install.sh` substitutes
  `@INSTALL_DIR@` at install time.
- `icons/meshviewer.svg` is the single icon source; `pnpm run icons` regenerates
  PNG, ICO and the 1024 px macOS PNG from it.
- GitHub release automation (`.github/workflows/release.yml`): lint and tests
  run once in a `checks` job, then Linux/Windows/macOS builds run in parallel
  and a `publish` job assembles the GitHub release on `v*` tags, taking the
  notes from the changelog's versioned section (`[Unreleased]` as a fallback).
  `.forgejo/workflows/release.yml` builds the Linux artifacts for Codeberg.

## Testing

| Project | Location | Scope |
| --- | --- | --- |
| `unit` | `tests/unit/` | Pure helpers (`utils.js`) |
| `main` | `tests/main/` | Real temp fixtures against `fsIpc`, `settingsStore`, `thumbnails` |
| `renderer` | `tests/renderer/` | jsdom tests (directory tree) |
| e2e | `tests/e2e/` | Playwright `_electron` runs against the real app |

`npm test` runs the Vitest projects; e2e needs a display.

## Known quirks

- `app.exit()` hangs while the modal About window is open — tests must `destroy()`
  it first.
- `console.log` in the main process is stdout-buffered and can be lost on kill;
  probes should use `console.error`.
- `#current-dir` is editable: Enter navigates to the typed path (the tree expands
  if possible), Esc or blur restores the current directory.
