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
  This has to be solved cross-platform. Ideally it would use the OS
  settings for the image type and show a list of known apps that work
  with the image. Maybe this is too complicated? Let's discuss it first
  and find alternative approaches.

- An entry that shows/uses the same dialog as the EXIF info toolbar icon
