#!/bin/sh
# Installs MeshViewer as a desktop application for the current user.
#
#   ./install.sh              -> installs
#   ./install.sh --uninstall  -> removes the installation again
#
# Only files under $HOME/.local/share are written,
# no system privileges (sudo) are required.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="meshviewer"
DESKTOP_TEMPLATE="$PROJECT_DIR/$APP_NAME.desktop"
ICON_SRC="$PROJECT_DIR/icons/$APP_NAME.svg"

APPS_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
DESKTOP_DEST="$APPS_DIR/$APP_NAME.desktop"
ICON_DEST="$ICON_DIR/$APP_NAME.svg"

do_uninstall() {
  rm -f "$DESKTOP_DEST" "$ICON_DEST"
  echo "MeshViewer uninstalled (removed $DESKTOP_DEST)."
}

if [ "$1" = "--uninstall" ]; then
  do_uninstall
  exit 0
fi

if [ ! -f "$DESKTOP_TEMPLATE" ]; then
  echo "Error: $DESKTOP_TEMPLATE is missing" >&2
  exit 1
fi
if [ ! -f "$ICON_SRC" ]; then
  echo "Error: $ICON_SRC is missing" >&2
  exit 1
fi

mkdir -p "$APPS_DIR" "$ICON_DIR"

# Replace the @INSTALL_DIR@ placeholder in the .desktop template with the actual
# project path. This keeps the template in Git free of absolute paths.
sed "s|@INSTALL_DIR@|$PROJECT_DIR|g" "$DESKTOP_TEMPLATE" > "$DESKTOP_DEST"
chmod 0644 "$DESKTOP_DEST"

cp "$ICON_SRC" "$ICON_DEST"
chmod 0644 "$ICON_DEST"

# Update the desktop database and icon cache (if present)
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi

echo "MeshViewer installed: $DESKTOP_DEST"
