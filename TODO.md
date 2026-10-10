# TODO

## Context menu

- Open with application: show the OS list of known apps for the image type (via
  xdg-mime / GNOME chooser) instead of only the configured default and editor —
  approach to be discussed first.

## File manager functions

- Drag and drop

## Folder tile previews

- Replace the plain folder icon with a Gwenview-style collage of up to four
  images from inside the folder. Deferred: it needs a per-folder preview scan and
  thumbnail generation for every visible tile (CPU), so it must be lazy
  (IntersectionObserver), capped at four and cached per folder.

## CSS variables

- Rename the transparency variables (`--checker-a`, `--checker-b`,
  `--transparency-background`): the names no longer describe how they are used
  now that the folder tiles override them.
