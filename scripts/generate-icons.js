#!/usr/bin/env node
const path = require("node:path");
const fsp = require("node:fs/promises");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "icons");
const SVG = path.join(ICONS_DIR, "meshviewer.svg");
const PNG = path.join(ICONS_DIR, "meshviewer.png");
const ICO = path.join(ICONS_DIR, "meshviewer.ico");
const PNG_SIZE = 256;
const ICO_SIZES = [256, 128, 64, 48, 32, 16];

/**
 * Runs a command synchronously and exits on failure.
 * @param {string} command - Command to run.
 * @param {string[]} args - Command arguments.
 */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`Error: ${command} failed with exit code ${result.status}`);
    process.exit(1);
  }
}

/**
 * Regenerates the PNG and ICO icons from the SVG source.
 * @returns {Promise<void>}
 */
async function generateIcons() {
  let sharp = null;
  try {
    sharp = require("sharp");
  } catch {
    console.error("Error: sharp is not available. Run `pnpm install` first.");
    process.exit(1);
  }

  await fsp.mkdir(ICONS_DIR, { recursive: true });
  await sharp(SVG, { density: PNG_SIZE }).resize(PNG_SIZE, PNG_SIZE).png().toFile(PNG);
  console.log(`Wrote ${path.relative(ROOT, PNG)}`);

  const tmp = path.join(ICONS_DIR, ".icon-src.png");
  await fsp.copyFile(PNG, tmp);
  run("magick", [tmp, "-define", `icon:auto-resize=${ICO_SIZES.join(",")}`, ICO]);
  await fsp.rm(tmp);
  console.log(`Wrote ${path.relative(ROOT, ICO)}`);
}

generateIcons();
