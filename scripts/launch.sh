#!/bin/sh
# Startet MeshViewer aus dem Projektverzeichnis
cd "$(dirname "$0")/.."
exec ./node_modules/.bin/electron .
