# TODO

## Context menu

- Open with application: show the OS list of known apps for the image type (via
  xdg-mime / GNOME chooser) instead of only the configured default and editor —
  approach to be discussed first.

## File manager functions

- Drag and drop

## CSS variables

- Rename the transparency variables (`--checker-a`, `--checker-b`,
  `--transparency-background`): the names no longer describe how they are used
  now that the folder tiles override them.

## Blender (.blend) preview — postponed, needs a decision

Goal: show a preview for local `.blend` files, both as grid thumbnails and in
the large view (fullscreen). All facts below were verified on this machine
(Blender 5.2.1 LTS, sample files: ogro.blend 2.58, BlenderKit rocket 3.06,
test file 5.02).

### How Blender previews work

- A `.blend` can embed a small preview of the scene (Preferences → Save & Load
  → “Save Preview Images”). It is stored as a block with code `TEST`; payload
  is `int32 width`, `int32 height`, then `width * height * 4` bytes RGBA
  (observed 128×128). Works independent of Blender version (tested 2.58, 3.06,
  5.02). Old files may have none (BlenderKit downloads here have none).
- Files can be uncompressed, gzip, or - since ~Blender 3.0 - zstd-compressed
  (default, whole file, *multiple* zstd frames). Node's `zlib.zstdDecompress`
  only decodes the first frame (fails on real files); the pure-JS `fzstd`
  package decodes the full stream (verified).
- Blender 5 changed the container: 17-byte file header and 32-byte block
  headers (previously 12-byte header, 24-byte block headers). Pointer size
  (4/8) and endianness vary. A hand-rolled parser must cover all of these.
- Headless Blender cannot generate an embedded preview (`wm.thumbnail_writer`
  does not exist in 5.2, no viewport → no preview). Re-saving a file in
  background mode only keeps an existing preview, it does not create one.
- `blender-thumbnailer` (ships with Blender on Linux) extracts the embedded
  preview to PNG (non-zero exit when none). MeshViewer already consults the
  freedesktop thumbnail cache in `readFreedesktopThumbnail()`.

### Candidate library: `jsblender` (npm, MIT, ESM-only)

- Pure JS, runs in Node and the browser; only dependency is `fzstd`.
- `parseBlend()` handles decompression (zstd/gzip/none) and both container
  layouts (12/17-byte header, 24/32-byte block headers).
- `extractMeshes()` / `extractMaterials()` / `extractObjects()` /
  `extractScenes()` / `extractArmatures()` only support the modern
  *AttributeStorage* mesh layout (Blender 5+). Pre-5 meshes throw
  (“Struct Mesh has no field attribute_storage”).
- Verified: parses 2.58 (uncompressed), 3.06 (zstd), 5.02 files; finds the
  `TEST` block (via `blend.blocks`, pixels via `blend.reader.buf.subarray()`).
- Caveat: author warns it is “heavily vibe-coded, not reviewed”; validate
  against real files and pin the version.
- Re-save migrates old files: opening a 2.58/3.06 file in Blender 5.2 and
  saving rewrites meshes into the modern layout → `jsblender` then extracts
  mesh/material/object/armature data (verified). Never overwrite the original
  file — save to a temp/cache copy.

### Thumbnails (all variants)

- `src/fsIpc.js` `listMediaFiles()`: add `.blend` as a new `type: "blend"`
  (skip `.blend1` backup files).
- `src/thumbnails.js`: new `extractBlendThumbnail(path)` — decompress with
  `fzstd`/`zlib`, find the `TEST` block, feed the RGBA payload through the
  existing `sharp` pipeline (`generateThumbnail`, 256 px JPEG). Fallback order:
  own cache → embedded preview → existing `readFreedesktopThumbnail()` →
  placeholder.
- Verify channel order / vertical flip of the TEST pixels during
  implementation (sample was gray, order not conclusively identified; Blender
  may store premultiplied alpha or flipped rows).

### Large view (decision still open)

Current `show()` in `src/renderer/large-view.js` only branches `glb` / `image`;
a `.blend` would fall into the image branch and render a broken `<img>`.
Options:

- A) Show the embedded preview as an image (zoom, slideshow, navigation work
  via the existing image viewer; 128×128 → soft when upscaled), placeholder +
  hint for files without preview.
- B) Interactive 3D like GLB: run `jsblender` in the renderer and build a
  three.js scene (meshes + Principled materials + object world matrices) using
  the existing GLB viewer contract (`src/renderer/3d/view.js`). Only works for
  files saved in the modern layout (Blender 5 or re-saved); fall back to A and
  a hint for old files.
- C) B plus an optional “Convert with Blender” action that spawns
  `blender --background <file> --python-expr "bpy.ops.wm.save_as_mainfile(...)"`
  into a temp file (new IPC, same pattern as the existing `shell:openPath` in
  `src/fsIpc.js`) and then loads the meshes from the temp copy. Closes the gap
  for old files; takes seconds, one-time per file, needs Blender installed.

### Follow-ups when implementing

- i18n keys in `src/locales/en.json` and `de.json` (default English per repo
  convention): `grid.typeBlend`, large-view hints/placeholder.
- `README.md` formats list, `CHANGELOG.md` entry, tests in `tests/main/` for
  the blend parsing logic (pure logic → no Electron needed).

## Clean-up after the JPEG crop and rotation work

Findings from the review; none of it is a bug, all of it is hygiene.

### Tests

- `tests/main/rotate.test.js` and `tests/main/crop.test.js` define `succeedWith`,
  `recordingStep` and `dirEntries` twice → move them into `tests/main/helpers/`.
- `regionFromPoints`, `moveRegion` and `resizeRegion` (the drag geometry in
  `src/renderer/crop.js`) have no direct tests, only indirectly through the E2E
  crop test.

### One JPEG frame header parser instead of two

- `tests/main/helpers/jpeg.js` (`jpegSize`) and `src/renderer/crop.js`
  (`imcuSize`) both walk the JPEG marker chain. Merge them into one
  `readJpegFrame(bytes)` → `{width, height, imcu}` that both use. It has to live
  under `src/renderer/`: the `app://` protocol only serves `src/renderer`,
  `node_modules` and `locales`, so the renderer cannot import from `src/`.

### Structure

- `src/renderer/large-view.js` grew to 1236 lines and 58 functions.
  `createImageView` (zoom, pan, swipe, ~330 lines) is still inline while the
  other two view modes are their own modules → move it to
  `src/renderer/image-view.js`, mirroring `3d/view.js` and
  `equirectangular/view.js`.

### Small things

- `src/renderer/crop-overlay.js` returns an `element` that nobody uses.
- `src/jpegTransform.js` exports `isJpegPath`, which is only used internally.
