# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

`meshviewer` is an Electron application that renders local `*.glb` files as thumbnails with three.js and displays image files in a grid. Vanilla JS (no framework), German UI.

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
- No hardcoded absolute paths in committed files. `meshviewer.desktop` is a template using the `@INSTALL_DIR@` placeholder; `install.sh` substitutes it at install time. Desktop-entry localization (freedesktop `Comment[de]` style) lives in two places: `meshviewer.desktop` (manual install) and `package.json` → `build.linux.desktop.entry` (electron-builder/AppImage).
- Never install into `~/.local/share` — only create files inside the project directory.

## Commands

- `npm start` – run the app
- `npm run pack` – electron-builder `--dir` (unpacked)
- `npm run dist:linux` / `npm run dist:win` / `npm run dist` – build distributables
- `npm run lint` / `npm run lint:fix` – Biome check (`biome.json`; `src/renderer/vendor/` and `dist/` are ignored)
- Electron binary may need its postinstall re-run after upgrades: `node node_modules/electron/install.js` (npm may block postinstall scripts; `allowScripts` in `package.json`).

## Testing

- `npm test` – run all Vitest projects (unit, main, renderer)
- `npm run test:unit` / `npm run test:main` / `npm run test:e2e` – run a single project
- Vitest config lives in `vitest.config.mjs` (three projects: `unit` = pure helpers, `main` = Node + real temp fixtures, `renderer` = jsdom). Tests live in `tests/unit/`, `tests/main/`, `tests/renderer/`.
- E2E tests (Playwright, `_electron`) live in `tests/e2e/` with config `playwright.config.mjs`; they launch the real app and need a display. Playwright was installed with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (no browsers needed for Electron).
- Testable code is kept out of the Electron runtime where possible: filesystem IPC logic lives in `src/fsIpc.js` (takes `ipcMain`/`app`/`shell` as arguments), renderer helpers in `src/renderer/utils.js`. Keep new pure logic there or in `tests/*` rather than in `main.js`/`renderer.js`.

## Architecture

- `src/main.js` – main process: custom `app://` protocol (`protocol.handle`) with CSP header, application menu (`Hilfe → Über MeshViewer` opens a modal About window via data URL)
- `src/fsIpc.js` – testable filesystem IPC logic (`fs:*`, `fs:locale`, `shell:openPath`), wired to Electron in `main.js` via `registerFsIpc(ipcMain, app, shell)`
- `src/preload.js` – `contextBridge` API exposed as `window.api` (typed via `@typedef {MeshViewerApi}`)
- `src/renderer/` – UI: vanilla directory tree (`tree.js`, rooted at `/`), thumbnail grid (`renderer.js`), GLB rendering via three.js (GLTFLoader), image display (thumbnail + large view), `styles.css`, `i18n.js` (i18next init + `t()`), `utils.js` (size/MIME helpers)
- `src/locales/` – `en.json` (default) and `de.json` (translation) for i18next
- `package.json` holds the electron-builder config (Linux AppImage+tar.gz, Windows nsis+portable+zip). macOS cannot be built from Linux (needs a macOS CI runner).

## Known quirks

- `app.exit()` hangs while a modal window is open — tests must `destroy()` the About window first.
- `console.log` from the main process is stdout-buffered and can be lost on kill; use `console.error` in probes.
- `#current-dir` is an editable path input: Enter navigates to the entered path (tree is expanded if possible), Esc or blur reverts to the current directory.

## Formats

- 3D: `.glb` only. Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`, `.bmp`, `.svg`, `.ico`. Thumbnails of images smaller than the tile are shown at natural size, centered (`.thumb.natural`).
