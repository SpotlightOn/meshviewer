# Conventions

Naming and shape rules for the code. They describe what the modules already do,
so the closest existing module is always the best example. When a rule and a
neighbouring file disagree, follow the rule and fix the file.

## File names

- **kebab-case**, lowercase, one module per file. The name says what the module
  is, not where it is used: `large-view.js`, `image-view.js`, `crop-geometry.js`.
- **Unique across the repo.** A basename identifies exactly one module, so a
  search for `crop-geometry.js` cannot land in the wrong layer. Where the same
  kind of module exists once per domain, the domain is the prefix:
  `3d/glb-view.js` vs `equirectangular/pano-view.js`, `glb-utils.js` vs
  `pano-utils.js`.
- **Name the subject, not the leftovers.** No new `utils.js` or `helpers.js` —
  call the file after what it contains (`zoom.js`, `jpeg-frame.js`) and keep
  image helpers with the other image helpers.
- **Tests mirror the source path** and keep the module name:
  `src/renderer/3d/glb-view.js` → `tests/renderer/3d/glb-view.test.js`.
- **CSS**: one module per BEM block, named after the block
  (`src/renderer/styles/large-view.css` for the `large-view` block) — see
  AGENTS.md, “CSS modules”, which holds the full rule.

## Exports

- **Factories** are `createX()` and return an object of closures:
  `createGrid()`, `createLargeView()`, `createContextMenu()`.
- **IPC registration** is `registerXIpc(ipcMain)`: `registerFsIpc()`,
  `registerImageIpc()`, `registerEditorIpc()`.
- **Predicates** are `isX` / `hasX` / `canX`: `isJpeg()`, `isPixmap()`,
  `hasSelection()`, `canEditImage()`.
- **Accessors** are `getX`: `getFiles()`, `getEntry()`, `getRegion()`.
- **Event handlers** are named after the event they handle: `onKeydown`,
  `pointerdown`, `pointermove`, `onSelect`, `onSaved`, `onChange`.
- A module exports either its public functions by name (`cropJpeg()` in
  `jpeg-crop.js`) **or** one `createX` factory, not both. Helpers that stay
  inside the module are plain `function` declarations and are not exported.

## Data

- **Results** are `{ ok: true, … }` or `{ ok: false, code, detail }`, with a
  short machine-readable `code` (`"invalid-angle"`, `"not-jpeg"`, `"io"`) that
  the caller can branch on and an optional human-readable `detail`.
- **Records** are plain objects with a `kind` discriminant where several shapes
  are possible (`{ kind: "file" | "folder" }`), documented as a `@typedef`.
- **Constants** are `SCREAMING_SNAKE_CASE` and live at the top of the file
  (`MAX_ZOOM`, `TILE_STEP`, `DEFAULT_SETTINGS`).
- **Every function carries JSDoc** in English with `@param`/`@returns` — see
  AGENTS.md, “Code style”. No inline comments unless they explain a non-obvious
  decision.

## Strings

- Code, identifiers, comments, docs and commit messages are **English**.
- UI strings go through i18next only: nested by area, camelCase leaves
  (`grid.typeGlb`, `shortcuts.cropMove`, `settings.thumbnailFit`), added to both
  `src/locales/en.json` and `src/locales/de.json`.
- German appears in `src/locales/de.json` only (plus the `Comment[de]` entries
  of the desktop files).

## Layers

- Pure logic stays out of the Electron runtime so it can be unit-tested:
  filesystem and JPEG work as functions that take their dependencies
  (`fs-ipc.js`, `jpeg-crop.js`), UI helpers as pure modules in
  `src/renderer/`. Wiring lives in `main.js` and `renderer.js`.
- The renderer never touches Node; everything goes through `window.api`
  (`preload.js`).
- The three view modes follow one controller contract
  (`activate`/`deactivate`/`setZoomPercent`/`zoomIn`/`zoomOut`/`reset`/`dispose`)
  on top of `three/render-surface.js`.
