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
        <input id="settings-verify-checksum" type="checkbox" class="switch-input" />
        <select id="settings-thumbnail-fit">
          <option value="cover">cover</option>
          <option value="contain">contain</option>
        </select>
        <select id="settings-transparency">
          <option value="checkerboard">checkerboard</option>
          <option value="white">white</option>
          <option value="custom">custom</option>
        </select>
        <div class="settings-row">
          <input id="settings-transparency-color" type="color" value="#ffffff" />
        </div>
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
      verify: document.getElementById("settings-verify-checksum"),
      thumbnailFit: document.getElementById("settings-thumbnail-fit"),
      transparency: document.getElementById("settings-transparency"),
      transparencyColor: document.getElementById("settings-transparency-color"),
      save: document.getElementById("settings-save"),
      cancel: document.getElementById("settings-cancel"),
    },
  });
  return {
    settings,
    editor: document.getElementById("settings-editor"),
    verify: document.getElementById("settings-verify-checksum"),
    transparency: document.getElementById("settings-transparency"),
    transparencyColor: document.getElementById("settings-transparency-color"),
    thumbnailFit: document.getElementById("settings-thumbnail-fit"),
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

describe("createSettings file operations", () => {
  beforeEach(() => {
    window.api = undefined;
    document.body.innerHTML = "";
  });

  it("pre-fills the checksum switch from the loaded settings", async () => {
    const { settings, verify } = makeSettings({ initial: { verifyMoveChecksum: false } });
    await settings.load();
    settings.open();
    expect(verify.checked).toBe(false);
  });

  it("persists the checksum switch state on save", async () => {
    const { settings, verify, save, calls } = makeSettings({
      initial: { verifyMoveChecksum: true },
    });
    await settings.load();
    settings.open();
    expect(verify.checked).toBe(true);

    verify.checked = false;
    save.click();
    await flush();
    expect(calls.saved.at(-1).verifyMoveChecksum).toBe(false);
    expect(settings.get().verifyMoveChecksum).toBe(false);
  });
});

describe("createSettings transparency background", () => {
  beforeEach(() => {
    window.api = undefined;
    document.body.innerHTML = "";
  });

  it("pre-fills the transparency controls and hides the color picker unless custom", async () => {
    const { settings, transparency, transparencyColor } = makeSettings({
      initial: { transparencyBackground: "white", transparencyColor: "#123456" },
    });
    await settings.load();
    settings.open();
    expect(transparency.value).toBe("white");
    expect(transparencyColor.value).toBe("#123456");
    expect(transparencyColor.closest(".settings-row").hidden).toBe(true);
  });

  it("shows the color picker for the custom mode", async () => {
    const { settings, transparencyColor } = makeSettings({
      initial: { transparencyBackground: "custom" },
    });
    await settings.load();
    settings.open();
    expect(transparencyColor.closest(".settings-row").hidden).toBe(false);
  });

  it("persists the transparency background and color on save", async () => {
    const { settings, transparency, transparencyColor, save, calls } = makeSettings();
    await settings.load();
    settings.open();
    transparency.value = "custom";
    transparencyColor.value = "#abcdef";
    save.click();
    await flush();
    expect(calls.saved.at(-1).transparencyBackground).toBe("custom");
    expect(calls.saved.at(-1).transparencyColor).toBe("#abcdef");
  });
});

describe("createSettings thumbnail fit", () => {
  beforeEach(() => {
    window.api = undefined;
    document.body.innerHTML = "";
  });

  it("pre-fills the thumbnail fit from the loaded settings", async () => {
    const { settings, thumbnailFit } = makeSettings({ initial: { thumbnailFit: "contain" } });
    await settings.load();
    settings.open();
    expect(thumbnailFit.value).toBe("contain");
  });

  it("persists the thumbnail fit on save and exposes it to the grid via a CSS variable", async () => {
    const { settings, thumbnailFit, save, calls } = makeSettings();
    await settings.load();
    settings.open();
    thumbnailFit.value = "contain";
    save.click();
    await flush();
    expect(calls.saved.at(-1).thumbnailFit).toBe("contain");
    expect(document.documentElement.style.getPropertyValue("--thumb-fit")).toBe("contain");
  });
});

describe("createSettings sidebar width", () => {
  beforeEach(() => {
    window.api = undefined;
    document.body.innerHTML = "";
  });

  it("applies the loaded sidebar width as a CSS variable", async () => {
    const { settings } = makeSettings({ initial: { sidebarWidth: 320 } });
    await settings.load();
    expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("320px");
  });

  it("persists a new sidebar width and applies it", async () => {
    const { settings, calls } = makeSettings({ initial: { sidebarWidth: 280 } });
    await settings.load();
    await settings.saveSidebarWidth(400);
    expect(calls.saved.at(-1).sidebarWidth).toBe(400);
    expect(document.documentElement.style.getPropertyValue("--sidebar-width")).toBe("400px");
  });

  it("clamps a too small sidebar width when applying", async () => {
    const { settings } = makeSettings({ initial: { sidebarWidth: 280 } });
    await settings.load();
    settings.applySidebarWidth(10);
    expect(settings.get().sidebarWidth).toBe(160);
  });
});
