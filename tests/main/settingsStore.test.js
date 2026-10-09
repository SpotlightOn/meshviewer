import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "../../src/settingsStore.js";

let fixtureDir;

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "meshviewer-settings-"));
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("normalizeSettings", () => {
  it("returns the defaults for empty input", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    expect(
      normalizeSettings({
        slideshowIntervalSeconds: 7,
        slideshowTransition: "slide",
        animationDurationMs: 800,
      }),
    ).toEqual({
      slideshowIntervalSeconds: 7,
      slideshowTransition: "slide",
      animationDurationMs: 800,
      editorCommand: "",
      transparencyBackground: "checkerboard",
      transparencyColor: "#ffffff",
      thumbnailFit: "cover",
      sidebarWidth: 280,
    });
  });

  it("keeps the editor command, trims it and ignores non-strings", () => {
    expect(normalizeSettings({ editorCommand: "  /usr/bin/gimp  " }).editorCommand).toBe(
      "/usr/bin/gimp",
    );
    expect(normalizeSettings({ editorCommand: 42 }).editorCommand).toBe("");
    expect(normalizeSettings({ editorCommand: null }).editorCommand).toBe("");
    expect(normalizeSettings({ editorCommand: "" }).editorCommand).toBe("");
  });

  it("clamps the interval to the allowed range and rounds it", () => {
    expect(normalizeSettings({ slideshowIntervalSeconds: 0.5 }).slideshowIntervalSeconds).toBe(1);
    expect(normalizeSettings({ slideshowIntervalSeconds: 10000 }).slideshowIntervalSeconds).toBe(
      3600,
    );
    expect(normalizeSettings({ slideshowIntervalSeconds: 3.7 }).slideshowIntervalSeconds).toBe(4);
  });

  it("rejects unknown transitions", () => {
    expect(normalizeSettings({ slideshowTransition: "zoom" }).slideshowTransition).toBe("slide");
  });

  it("clamps the animation duration to the allowed range and rounds it", () => {
    expect(normalizeSettings({ animationDurationMs: -100 }).animationDurationMs).toBe(0);
    expect(normalizeSettings({ animationDurationMs: 99999 }).animationDurationMs).toBe(5000);
    expect(normalizeSettings({ animationDurationMs: 150.4 }).animationDurationMs).toBe(150);
    expect(normalizeSettings({ animationDurationMs: "fast" }).animationDurationMs).toBe(300);
  });

  it("keeps a known transparency background and rejects unknown ones", () => {
    expect(normalizeSettings({ transparencyBackground: "white" }).transparencyBackground).toBe(
      "white",
    );
    expect(normalizeSettings({ transparencyBackground: "custom" }).transparencyBackground).toBe(
      "custom",
    );
    expect(normalizeSettings({ transparencyBackground: "rainbow" }).transparencyBackground).toBe(
      "checkerboard",
    );
  });

  it("keeps a known thumbnail fit and rejects unknown ones", () => {
    expect(normalizeSettings({ thumbnailFit: "contain" }).thumbnailFit).toBe("contain");
    expect(normalizeSettings({ thumbnailFit: "cover" }).thumbnailFit).toBe("cover");
    expect(normalizeSettings({ thumbnailFit: "stretch" }).thumbnailFit).toBe("cover");
  });

  it("clamps the sidebar width to the allowed range and rounds it", () => {
    expect(normalizeSettings({ sidebarWidth: 10 }).sidebarWidth).toBe(160);
    expect(normalizeSettings({ sidebarWidth: 9999 }).sidebarWidth).toBe(720);
    expect(normalizeSettings({ sidebarWidth: 300.6 }).sidebarWidth).toBe(301);
    expect(normalizeSettings({ sidebarWidth: "wide" }).sidebarWidth).toBe(280);
  });

  it("keeps a valid hex transparency color and lowercases it, ignoring invalid ones", () => {
    expect(normalizeSettings({ transparencyColor: "#AABBCC" }).transparencyColor).toBe("#aabbcc");
    expect(normalizeSettings({ transparencyColor: "red" }).transparencyColor).toBe("#ffffff");
    expect(normalizeSettings({ transparencyColor: "#fff" }).transparencyColor).toBe("#ffffff");
  });
});

describe("loadSettings / saveSettings", () => {
  it("falls back to the defaults when the file does not exist", async () => {
    await expect(loadSettings(join(fixtureDir, "missing.json"))).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to the defaults on a corrupt file", async () => {
    const file = join(fixtureDir, "corrupt.json");
    await writeFile(file, "not json");
    await expect(loadSettings(file)).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("persists and reloads settings", async () => {
    const file = join(fixtureDir, "settings.json");
    const saved = await saveSettings(file, {
      slideshowIntervalSeconds: 10,
      slideshowTransition: "slide",
      animationDurationMs: 1200,
      editorCommand: "/usr/bin/gimp",
    });
    expect(saved).toEqual({
      slideshowIntervalSeconds: 10,
      slideshowTransition: "slide",
      animationDurationMs: 1200,
      editorCommand: "/usr/bin/gimp",
      transparencyBackground: "checkerboard",
      transparencyColor: "#ffffff",
      thumbnailFit: "cover",
      sidebarWidth: 280,
    });
    await expect(loadSettings(file)).resolves.toEqual({
      slideshowIntervalSeconds: 10,
      slideshowTransition: "slide",
      animationDurationMs: 1200,
      editorCommand: "/usr/bin/gimp",
      transparencyBackground: "checkerboard",
      transparencyColor: "#ffffff",
      thumbnailFit: "cover",
      sidebarWidth: 280,
    });
    const raw = await readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({
      slideshowIntervalSeconds: 10,
      slideshowTransition: "slide",
      animationDurationMs: 1200,
      editorCommand: "/usr/bin/gimp",
      transparencyBackground: "checkerboard",
      transparencyColor: "#ffffff",
      thumbnailFit: "cover",
      sidebarWidth: 280,
    });
  });
});
