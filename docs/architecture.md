# MeshViewer — Architecture

MeshViewer is an Electron application that shows local media files as a browsable
grid: `*.glb` models are rendered to thumbnails with three.js, images are shown
from a generated or embedded thumbnail. Selecting an item opens a large view with
keyboard navigation and a slideshow.

It is plain JavaScript — no framework, no bundler. The renderer loads ES modules
directly through a custom `app://` protocol.

## Process model

```
┌──────────────────────────── Electron main process ────────────────────────────┐
│ src/main.js        window, menu, About dialog, app:// protocol + CSP          │
│ src/fsIpc.js       filesystem IPC handlers (fs:*)                             │
│ src/thumbnails.js  thumbnail cache (sharp, freedesktop, EXIF)                 │
│ src/settingsStore.js  settings.json in userData (settings:*)                  │
└───────────────▲──────────────────────────────────────────────▲────────────────┘
                │ ipcRenderer.invoke / handle                  │ protocol.handle
┌───────────────┴───────────────┐   ┌──────────────────────────┴───────────────┐
│ src/preload.js                │   │ Renderer (src/renderer/)                 │
│ contextBridge → window.api    │   │ index.html, renderer.js, tree.js,        │
│ contextIsolation: true        │   │ i18n.js, utils.js, styles.css            │
│ nodeIntegration: false        │   │ three.js + vendored GLTFLoader           │
└───────────────────────────────┘   └──────────────────────────────────────────┘
```

- The renderer never touches Node or the filesystem directly. Everything goes
  through the typed `window.api` surface declared in `src/preload.js`.
- The preload exposes one function per IPC channel and returns promises; there is
  no generic `invoke(channel, …)` escape hatch.

## Module map

| File | Responsibility |
| --- | --- |
| `src/main.js` | App lifecycle, `app://` protocol with CSP, application menu, modal About window |
| `src/fsIpc.js` | `fs:*` handlers: directory listing, media filtering, file reads, locale, `shell:openPath` |
| `src/thumbnails.js` | Thumbnail generation and cache lookup; returns `null` when generation is impossible |
| `src/settingsStore.js` | Loads/validates/persists `settings.json`, registers `settings:*` handlers |
| `src/preload.js` | `contextBridge` API (`window.api`), typed via JSDoc `@typedef` |
| `src/renderer/renderer.js` | Grid, large view, slideshow, settings dialog, navigation |
| `src/renderer/tree.js` | Lazy directory tree with a bounded lookahead task queue |
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
- Grid cards render only when they approach the viewport, which keeps large
  directories responsive.
- The large view keeps a single token (`largeToken`) so a navigation that
  supersedes an in-flight load can ignore its result.

## Settings

`src/settingsStore.js` normalizes untrusted input against defaults
(`slideshowIntervalSeconds`, `slideshowTransition`), clamps the interval to
1–3600 seconds and rejects unknown transitions. The file lives in
`app.getPath('userData')/settings.json`; missing or corrupt files fall back to
defaults instead of failing.

## Internationalization

- Locale comes from the system (`app.getLocale()` → `fs:locale`); anything not
  German falls back to English.
- Main process: i18next drives the menu and the About window.
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

- electron-builder targets: Linux (AppImage, tar.gz) and Windows (nsis,
  portable, zip). macOS needs a macOS runner and cannot be built here.
- `meshviewer.desktop` is a template: `scripts/install.sh` substitutes
  `@INSTALL_DIR@` at install time.
- `icons/meshviewer.svg` is the single icon source; `npm run icons` regenerates
  PNG and ICO from it.
- Release automation: `.github/workflows/release.yml` and
  `.forgejo/workflows/release.yml`, both triggered by a `v*` tag push or a
  manual `workflow_dispatch`.

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
