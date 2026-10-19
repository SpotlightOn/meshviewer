# Usage

Keyboard shortcuts and mouse gestures, grouped by where they apply. The same
reference opens in the app from the menu bar (`Help → Usage`).

## Global

| Input | Action |
| --- | --- |
| `F11` | Toggle fullscreen |
| `Ctrl` + `+` / `-` / `0` | Zoom the whole UI (Electron default) |

Without `Ctrl`, `+`, `-` and `0` apply to the tile grid or the shown image
instead. `Esc` closes the active dialog (settings, file information, new folder,
confirmation).

## Toolbar

| Input | Action |
| --- | --- |
| Arrow button | Go one level up |
| Home button | Go to the user directory |
| Breadcrumb | Jump to that folder |

Clicking the current folder or the empty space behind the breadcrumbs switches
the path bar to a text field: `Enter` opens the typed path (the tree is expanded
if possible), `Esc` or clicking away reverts it.

## Directory tree

| Input | Action |
| --- | --- |
| Click a folder | Show its contents in the grid |
| Right click | Context menu for the folder |
| Click the twisty, or double-click the row | Expand / collapse the level |
| Drag the divider | Resize the sidebar (160–720 px, remembered) |
| `↑` / `↓` | Move the focus |
| `→` / `←` | Expand and step into / collapse and step out |
| `Space` | Expand / collapse the focused folder |
| `Enter` | Open the focused folder |
| `←` / `→` on the divider | Resize the sidebar by a step |

## File grid

| Input | Action |
| --- | --- |
| `+` / `=` | Larger tiles |
| `-` | Smaller tiles |
| `0` | Reset tile size |
| `Ctrl` + mouse wheel | Zoom tiles in / out |
| `Enter` | Open the selected tile |
| `Ctrl` / `Cmd` + `A` | Select all |
| `Ctrl` / `Cmd` + `C` / `X` / `V` | Copy, cut, paste into the current folder |
| `Delete` | Move the selection to the trash |
| `Esc` | Clear the selection |

| Mouse | Action |
| --- | --- |
| Left click | Select the tile (opens it with the “Single click” setting) |
| Double click | Open the tile |
| `Ctrl` / `Cmd` + click | Add to or remove from the selection |
| `Shift` + click | Select a range |
| Drag on empty space | Draw a selection rectangle |
| Right click | Context menu for the tile or the current folder |
| Mouse wheel | Scroll the grid |

## Large view

| Input | Action |
| --- | --- |
| `←` / `Backspace` | Previous file |
| `→` / `Space` | Next file |
| `F` | Toggle fit / 100 % (images) |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` / `1` | Reset zoom to 100 % |
| `F5` | Start / stop the slideshow |
| `Esc` | Close the large view |
| `F11` | Toggle fullscreen |

| Mouse | Action |
| --- | --- |
| Wheel | Zoom the image, dolly a 3D model, change the panorama field of view |
| Drag | Pan a zoomed image, orbit a 3D model |
| Right drag | Pan a 3D model |
| Drag horizontally while fitted | Previous / next file (a short drag snaps back) |
| Middle click | Toggle 100 % / fit (images) |

The zoom slider covers 10–800 %; the field next to it takes a typed value such
as `120`, applied with `Enter` or a click away and reverted with `Esc`. The two
buttons beside the field restore the actual size (1:1) and the fitted size.

For raster images the `Equirectangular` switch turns the file into a panorama:
dragging looks around, the wheel or the zoom slider changes the field of view.

While the slideshow runs, a 1 px progress line at the bottom of the header shows
the time until the next image.

In fullscreen the header and the status bar hide; moving the mouse reveals the
exit button, which fades again after a moment. `Esc` leaves the fullscreen
first, a second `Esc` closes the large view.

## Rotate, flip and crop (JPEG and JPEG XL)

The rotate, flip and crop buttons appear in the header while a `.jpg`/`.jpeg` or
`.jxl` file is shown. All of them run losslessly through the bundled jpegtran and
jxltran WebAssembly modules: rotation and flip rewrite the file in place, the
crop is written next to it as `<name>-crop-<n>.jpg`/`.jxl` and the source stays
untouched.

For a JPEG, rotation and flip rearrange the DCT blocks and the crop is a real
region of the image. For a JPEG XL, rotation and flip only replace the
orientation tag in the header — the pixels never move — and a crop is a
metadata-only canvas resize. Animations can be rotated and flipped that way, but
the crop button is hidden for them.

| Input | Action |
| --- | --- |
| Left drag | Draw the crop selection |
| Left drag inside the selection | Move it |
| Left drag on a handle | Resize it |
| `←` / `→` / `↑` / `↓` | Move the selection by one grid step |
| `Shift` + arrows | Resize the selection |
| `R` | Select the whole image again |
| `Enter` | Write the crop as a new file |
| `Esc` | Leave the crop mode |

The selection snaps to the iMCU grid of a JPEG, so the result is exactly the
area that was picked; a JPEG XL accepts any region.

### Undoing a JPEG XL crop

A JPEG XL crop deletes nothing: the pixels outside the selection stay in the file
and only the canvas gets smaller. As long as such a file still holds more image
than it shows, the large view offers an undo button; a JPEG never shows it,
because its crop really removes the data. A file that displays everything it
holds — and an animation, which carries one frame region per frame — has nothing
to undo.

One click writes the whole image back as `<name>-undo-<n>.jxl` next to the
cropped file, which stays as it is. Nothing is decoded or recompressed on the
way: the copy shows exactly the pixels the crop had left behind.
