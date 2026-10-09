# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

`meshviewer` is an Electron application that renders local `*.glb` files as thumbnails with three.js and displays image files in a grid. Vanilla JS (no framework), German UI.

## Git rules

- **Never push to a remote without the user reviewing the exact changes first.** Commit locally, show the diff, wait for explicit approval. This covers every push — new files, docs, config, CI, "trivial" fixes, follow-ups to an already approved change — and every force-push. Approval for one push is not approval for the next one.

## Language conventions

- **Code comments and JSDoc**: always English.
- **Documentation (README, docs)**: always English.
- **User-facing UI and console strings**: English by default; German is provided as a translation. All user-facing strings must go through i18next — never hardcode them. See the i18n section below.

## Internationalization (i18n)

- Translations live in `src/locales/en.json` (default) and `src/locales/de.json` (translation).
- The locale comes from the system via `app.getLocale()` (`fs:locale` IPC); any non-German locale falls back to English.
- Main process: `i18next` is initialized in `initI18n()` and used for the menu (`Hilfe/Help`) and the About window.
- Renderer: `src/renderer/i18n.js` initializes i18next and exposes `t()`; static HTML strings use `data-i18n` / `data-i18n-title` attributes applied by `applyTranslations()`.
- Add new strings to both locale files (same keys), keep the key structure (e.g. `grid.typeGlb`).

## Code style

- Add **JSDoc** to every function (English, with `@param`/`@returns`). See `src/renderer/tree.js` for the `@typedef` pattern.
- Do not add inline comments unless asked.
- No hardcoded absolute paths in committed files. `meshviewer.desktop` is a template using the `@INSTALL_DIR@` placeholder; `scripts/install.sh` substitutes it at install time. Desktop-entry localization (freedesktop `Comment[de]` style) lives in two places: `meshviewer.desktop` (manual install) and `package.json` → `build.linux.desktop.entry` (electron-builder/AppImage).
- Icons: `icons/meshviewer.svg` is the single source of truth. `pnpm run icons` regenerates `icons/meshviewer.png`, `icons/meshviewer.ico` and `icons/meshviewer-1024.png` (macOS icon) from it via `scripts/generate-icons.js` (sharp + ImageMagick). Always rerun it after changing the SVG.
- Never install into `~/.local/share` — only create files inside the project directory.

## Commands

- `pnpm start` – run the app
- `pnpm run icons` – regenerate `icons/meshviewer.png`, `icons/meshviewer.ico` and `icons/meshviewer-1024.png` from the SVG (`scripts/generate-icons.js`)
- `pnpm run pack` – electron-builder `--dir` (unpacked)
- `pnpm run dist:linux` / `pnpm run dist:win` / `pnpm run dist:mac` / `pnpm run dist` – build distributables (macOS builds need a macOS host; `dist` = Linux + Windows)
- `pnpm run lint` / `pnpm run lint:fix` – Biome check (`biome.json`; `src/renderer/vendor/` and `dist/` are ignored)
- Electron binary may need its postinstall re-run after upgrades: `node node_modules/electron/install.js` (pnpm blocks build scripts by default; approvals live in `pnpm-workspace.yaml` under `allowBuilds`).

## CI / releases

- Release automation: `.github/workflows/release.yml` (GitHub: Linux, Windows, macOS) and `.forgejo/workflows/release.yml` (Codeberg: Linux), triggered by a `v*` tag push or `workflow_dispatch`. On GitHub, lint and tests run once in a `checks` job before the per-OS builds, and the release notes are taken from the changelog's versioned section (`[Unreleased]` as a fallback).
- pnpm only links `sharp`'s platform packages for the host architecture, so the x64 macOS DMG is built without `@img/sharp-darwin-x64`; thumbnails on Intel Macs fall back to the full-file decode as documented above (arm64 and all other builds include the matching native binary).

## Changelog

- `CHANGELOG.md` (Keep a Changelog / SemVer) is updated in the same commit as every user-visible change.
- Entries are short keywords under `Added` / `Changed` / `Fixed` / `Removed` – no prose: the section is pasted into the GitHub release notes at release time.
- Skip changes users never see (CI, docs, tests, dependency bumps, refactors) unless they change behaviour or install steps.
- On release: rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, add a fresh empty `## [Unreleased]` above it and bump `version` in `package.json` in the same commit.

## Testing

- `pnpm test` – run all Vitest projects (unit, main, renderer)
- `pnpm run test:unit` / `pnpm run test:main` / `pnpm run test:e2e` – run a single project
- Vitest config lives in `vitest.config.mjs` (three projects: `unit` = pure helpers, `main` = Node + real temp fixtures, `renderer` = jsdom). Tests live in `tests/unit/`, `tests/main/`, `tests/renderer/`.
- E2E tests (Playwright, `_electron`) live in `tests/e2e/` with config `playwright.config.mjs`; they launch the real app through `tests/e2e/launch.js` and need a display. The helper sets `MESHVIEWER_E2E_HEADLESS=1` (honoured in `src/main-window.js`), so the app creates an unmapped window and a test run never takes the desktop focus. `packaged.spec.js` runs the `pnpm run pack` build from `dist/linux-unpacked` and is skipped when that build is missing. Playwright was installed with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (no browsers needed for Electron).
- Testable code is kept out of the Electron runtime where possible: filesystem IPC logic lives in `src/fsIpc.js` (takes `ipcMain`/`app`/`shell` as arguments), renderer helpers in `src/renderer/utils.js`. Keep new pure logic there or in `tests/*` rather than in `main.js`/`renderer.js`.

## Architecture

- `src/main.js` – main process: custom `app://` protocol (`protocol.handle`) with CSP header, application menu (`Hilfe → Über MeshViewer` opens a modal About window via data URL)
- `src/fsIpc.js` – testable filesystem IPC logic (`fs:*`, `fs:locale`, `shell:openPath`), wired to Electron in `main.js` via `registerFsIpc(ipcMain, app, shell)`
- `src/thumbnails.js` – testable thumbnail cache: 256 px JPEGs generated with `sharp` (N-API, no ABI rebuild) in `app.getPath('userData')/thumbnails`, keyed by sha1 of `path + size + mtimeMs`; exposed via `fs:getThumbnail` IPC. On cache miss it first checks the freedesktop thumbnail cache (`~/.cache/thumbnails/`, used by KDE/GNOME/XFCE) via `readFreedesktopThumbnail()`, then for `.jpg`/`.jpeg` extracts the embedded EXIF thumbnail via `piexifjs` (`readEmbeddedThumbnail()`, reads only the first 1 MB of the file) and generates from that, then falls back to a full decode. Returns `null` when `sharp` is unavailable or decoding fails (renderer falls back to the full-file blob)

Note: sharp's JS loader prints a `[SharpElectronLinux]` Node warning at startup whenever it runs inside Electron on Linux (see `node_modules/sharp/dist/sharp.cjs`, `process.emitWarning` with code `SharpElectronLinux`). It warns that Electron's Linux binaries dynamically link a globally-installed glib whose symbols leak into the process, which can collide with the glib bundled in sharp's libvips and in rare cases cause `GLib-GObject: g_object_ref/g_object_unref: assertion 'G_IS_OBJECT (object)' failed` crashes (see https://sharp.pixelplumbing.com/install#electron-and-linux, tracking issue electron/electron#46323). It is informational and expected; sharp works fine unless the app actually crashes with a GLib assertion.
- `src/preload.js` – `contextBridge` API exposed as `window.api` (typed via `@typedef {MeshViewerApi}`)
- `src/renderer/` – UI: vanilla directory tree (`tree.js`, rooted at `/`, lazy per-node loading with bounded (4 concurrent) one-level lookahead prefetch), resizable sidebar (`sidebar-resizer.js`, drag or arrow keys, width persisted as `sidebarWidth`), thumbnail grid (`renderer.js`) with lazy preview loading via `IntersectionObserver` and `content-visibility: auto`, GLB rendering via three.js (GLTFLoader), image display (thumbnail + large view), `styles.css`, `i18n.js` (i18next init + `t()`), `utils.js` (size/MIME helpers)
- `src/locales/` – `en.json` (default) and `de.json` (translation) for i18next
- `package.json` holds the electron-builder config (Linux AppImage+tar.gz, Windows nsis+portable+zip). macOS cannot be built from Linux (needs a macOS CI runner).

## Known quirks

- `app.exit()` hangs while a modal window is open — tests must `destroy()` the About window first.
- `console.log` from the main process is stdout-buffered and can be lost on kill; use `console.error` in probes.
- The path bar is a breadcrumb by default: clicking a folder navigates to it, clicking the active folder or empty space switches to a text field (Enter opens the entered path — the tree is expanded if possible — Esc or blur reverts to the current directory).

## Formats

- 3D: `.glb` only. Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.svg`, `.ico`. Thumbnails fill the tile with `object-fit` set from the “Thumbnail fit” setting (`cover` by default, `contain` optional); transparent areas show the configured transparency background.
