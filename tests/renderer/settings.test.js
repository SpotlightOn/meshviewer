import { beforeEach, describe, expect, it } from "vitest";
import { createSettings } from "../../src/renderer/settings.js";

/** Flushes pending microtasks and timers. */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds the settings dialog DOM and a wired settings module with mocked
 * window.api calls.
 * @param {object} [options] - Test options.
 * @param {object} [options.initial] - Settings returned by getSettings.
 * @param {string|null} [options.pick] - Value returned by pickExecutable.
 * @returns {{settings: ReturnType<typeof createSettings>, editor: HTMLInputElement, save: HTMLButtonElement, calls: {saved: Array<object>, picked: number}}} Test harness.
 */
function makeSettings({ initial = {}, pick = null } = {}) {
  const calls = { saved: [], picked: 0 };
  window.api = {
    getSettings: async () => initial,
    saveSettings: async (next) => {
      calls.saved.push(next);
      return { ...initial, ...next };
    },
    onOpenSettings: () => () => {},
    pickExecutable: async () => {
      calls.picked += 1;
      return pick;
    },
  };
  document.body.innerHTML = `
    <div id="settings-overlay" class="hidden">
      <div class="settings-dialog">
        <input id="settings-interval" type="number" />
        <select id="settings-transition">
          <option value="fade">fade</option>
          <option value="slide">slide</option>
        </select>
        <input id="settings-duration" type="number" />
        <input id="settings-editor" type="text" placeholder="/usr/bin/gimp" />
        <button id="settings-editor-browse" type="button">Browse…</button>
        <button id="settings-save" type="button">Save</button>
        <button id="settings-cancel" type="button">Cancel</button>
      </div>
    </div>`;
  const settings = createSettings({
    dom: {
      overlay: document.getElementById("settings-overlay"),
      interval: document.getElementById("settings-interval"),
      transition: document.getElementById("settings-transition"),
      duration: document.getElementById("settings-duration"),
      editor: document.getElementById("settings-editor"),
      editorBrowse: document.getElementById("settings-editor-browse"),
      save: document.getElementById("settings-save"),
      cancel: document.getElementById("settings-cancel"),
    },
  });
  return {
    settings,
    editor: document.getElementById("settings-editor"),
    save: document.getElementById("settings-save"),
    calls,
  };
}

describe("createSettings editor command", () => {
  beforeEach(() => {
    window.api = undefined;
    document.body.innerHTML = "";
  });

  it("pre-fills the editor field from the loaded settings", async () => {
    const { settings, editor } = makeSettings({ initial: { editorCommand: "/usr/bin/gimp" } });
    await settings.load();
    settings.open();
    expect(editor.value).toBe("/usr/bin/gimp");
  });

  it("persists the trimmed editor command on save", async () => {
    const { settings, editor, save, calls } = makeSettings();
    await settings.load();
    settings.open();
    editor.value = "  gimp  ";
    save.click();
    await flush();
    expect(calls.saved.at(-1).editorCommand).toBe("gimp");
    expect(settings.get().editorCommand).toBe("gimp");
  });

  it("fills the editor field from the browse dialog", async () => {
    const { editor, calls } = makeSettings({ pick: "/usr/bin/gimp" });
    document.getElementById("settings-editor-browse").click();
    await flush();
    expect(calls.picked).toBe(1);
    expect(editor.value).toBe("/usr/bin/gimp");
  });

  it("keeps the current value when the browse dialog is canceled", async () => {
    const { editor, calls } = makeSettings({ pick: null });
    editor.value = "/usr/bin/mypaint";
    document.getElementById("settings-editor-browse").click();
    await flush();
    expect(calls.picked).toBe(1);
    expect(editor.value).toBe("/usr/bin/mypaint");
  });
});
