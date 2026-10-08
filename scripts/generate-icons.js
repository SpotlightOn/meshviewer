#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const ICONS_DIR = path.join(ROOT, "icons");
const SVG = path.join(ICONS_DIR, "meshviewer.svg");
const PNG = path.join(ICONS_DIR, "meshviewer.png");
const PNG_MAC = path.join(ICONS_DIR, "meshviewer-1024.png");
const ICO = path.join(ICONS_DIR, "meshviewer.ico");
const PNG_SIZE = 256;
const PNG_MAC_SIZE = 1024;
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
 * Regenerates the PNG, macOS PNG and ICO icons from the SVG source.
 * @returns {Promise<void>}
 */
async function generateIcons() {
  let sharp = null;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error("Error: sharp is not available. Run `pnpm install` first.");
    process.exit(1);
  }

  await fsp.mkdir(ICONS_DIR, { recursive: true });
  await sharp(SVG, { density: PNG_SIZE }).resize(PNG_SIZE, PNG_SIZE).png().toFile(PNG);
  console.log(`Wrote ${path.relative(ROOT, PNG)}`);

  await sharp(SVG, { density: PNG_MAC_SIZE })
    .resize(PNG_MAC_SIZE, PNG_MAC_SIZE)
    .png()
    .toFile(PNG_MAC);
  console.log(`Wrote ${path.relative(ROOT, PNG_MAC)}`);

  const tmp = path.join(ICONS_DIR, ".icon-src.png");
  await fsp.copyFile(PNG, tmp);
  run("magick", [tmp, "-define", `icon:auto-resize=${ICO_SIZES.join(",")}`, ICO]);
  await fsp.rm(tmp);
  console.log(`Wrote ${path.relative(ROOT, ICO)}`);
}

generateIcons();
