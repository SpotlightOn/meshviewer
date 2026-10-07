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
    });
  });

  it("clamps the interval to the allowed range and rounds it", () => {
    expect(normalizeSettings({ slideshowIntervalSeconds: 0.5 }).slideshowIntervalSeconds).toBe(1);
    expect(normalizeSettings({ slideshowIntervalSeconds: 10000 }).slideshowIntervalSeconds).toBe(
      3600,
    );
    expect(normalizeSettings({ slideshowIntervalSeconds: 3.7 }).slideshowIntervalSeconds).toBe(4);
  });

  it("rejects unknown transitions", () => {
    expect(normalizeSettings({ slideshowTransition: "zoom" }).slideshowTransition).toBe("fade");
  });

  it("clamps the animation duration to the allowed range and rounds it", () => {
    expect(normalizeSettings({ animationDurationMs: -100 }).animationDurationMs).toBe(0);
    expect(normalizeSettings({ animationDurationMs: 99999 }).animationDurationMs).toBe(5000);
    expect(normalizeSettings({ animationDurationMs: 150.4 }).animationDurationMs).toBe(150);
    expect(normalizeSettings({ animationDurationMs: "fast" }).animationDurationMs).toBe(1000);
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
    });
    expect(saved).toEqual({
      slideshowIntervalSeconds: 10,
      slideshowTransition: "slide",
      animationDurationMs: 1200,
    });
    await expect(loadSettings(file)).resolves.toEqual({
      slideshowIntervalSeconds: 10,
      slideshowTransition: "slide",
      animationDurationMs: 1200,
    });
    const raw = await readFile(file, "utf8");
    expect(JSON.parse(raw)).toEqual({
      slideshowIntervalSeconds: 10,
      slideshowTransition: "slide",
      animationDurationMs: 1200,
    });
  });
});
