# TODO

## EXIF info

Detail image view toolbar: a new info icon placed before fullscreen.
Clicking it opens a dialog that shows all EXIF information.
Library chosen: exifreader (researched 2026-10).
Use this icon: https://fonts.google.com/icons?selected=Material+Symbols+Outlined:info:FILL@0;wght@400;GRAD@0;opsz@24&icon.query=info&icon.size=24&icon.color=%231f1f1f

If there is no EXIF info, only known basic information is shown:
filesize, image size, date, type.

## Context menu

Each image thumbnail should have a context menu that is very flexible,
extensible and modular. Use event delegation and avoid binding events
to individual thumbnails.

The initial context menu is very simple for now, but is planned to grow.

- Open with application
  MVP done: “Open with default application” opens the OS handler, and the
  settings dialog holds a configurable editor command behind an “Edit with …”
  menu entry. Showing the OS list of known apps for the image type (via
  xdg-mime / GNOME chooser) is still open — discuss first.

- An entry that shows/uses the same dialog as the EXIF info toolbar icon

## Map markers (OpenStreetMap)

When a photo carries GPS coordinates, show the location on a map inside the
file information dialog.

- Tiles: OpenStreetMap (tile.openstreetmap.org); needs network access, ask
  about the privacy trade-off later (e.g. load tiles only on demand).
- Lightest option: a static tile image with a marker overlay; a Leaflet map
  embed would allow pan/zoom but adds a dependency.
- Open the exact coordinates in the default browser (openstreetmap.org) via a
  small button/link.

## Startscreen

When there are no images, the app currently shows:

No *.glb, *.png, *.jpg, *.webp, *.gif, *.avif, *.bmp, *.svg or *.ico files were found in this folder.

It would be better to show an SVG logo instead, followed by the text, but somewhat larger:

Done: the empty state shows `icons/meshviewer.svg` above the message, which is
rendered from the existing locale keys (`grid.noMedia`, `grid.loadError`).
