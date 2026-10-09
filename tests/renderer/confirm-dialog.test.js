import { beforeEach, describe, expect, it } from "vitest";
import { createConfirmDialog } from "../../src/renderer/confirm-dialog.js";

/**
 * Builds the confirmation dialog DOM and a wired module.
 * @returns {object} Dialog API and DOM references.
 */
function makeDialog() {
  document.body.innerHTML = `
    <div id="confirm-overlay" class="settings-overlay hidden">
      <div class="settings-dialog">
        <h2 id="confirm-title"></h2>
        <p id="confirm-message"></p>
        <button id="confirm-cancel" type="button">Cancel</button>
        <button id="confirm-accept" type="button"></button>
      </div>
    </div>`;
  const dialog = createConfirmDialog({
    dom: {
      overlay: document.getElementById("confirm-overlay"),
      title: document.getElementById("confirm-title"),
      message: document.getElementById("confirm-message"),
      accept: document.getElementById("confirm-accept"),
      cancel: document.getElementById("confirm-cancel"),
    },
  });
  return {
    dialog,
    overlay: document.getElementById("confirm-overlay"),
    title: document.getElementById("confirm-title"),
    message: document.getElementById("confirm-message"),
    accept: document.getElementById("confirm-accept"),
    cancel: document.getElementById("confirm-cancel"),
  };
}

describe("createConfirmDialog", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves true when the accept button is clicked", async () => {
    const { dialog, title, message, accept } = makeDialog();

    const promise = dialog.open({
      title: "Move folder to trash",
      message: "Move it?",
      acceptLabel: "Move",
    });

    expect(dialog.isOpen()).toBe(true);
    expect(title.textContent).toBe("Move folder to trash");
    expect(message.textContent).toBe("Move it?");
    expect(accept.textContent).toBe("Move");
    expect(document.activeElement).toBe(document.getElementById("confirm-cancel"));

    accept.click();

    await expect(promise).resolves.toBe(true);
    expect(dialog.isOpen()).toBe(false);
  });

  it("resolves false when canceled", async () => {
    const { dialog, cancel } = makeDialog();
    const promise = dialog.open({ title: "t", message: "m" });
    cancel.click();
    await expect(promise).resolves.toBe(false);
    expect(dialog.isOpen()).toBe(false);
  });

  it("resolves false on an overlay click or a programmatic close", async () => {
    const { dialog, overlay } = makeDialog();
    const first = dialog.open({ title: "t", message: "m" });
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(first).resolves.toBe(false);

    const second = dialog.open({ title: "t", message: "m" });
    dialog.close();
    await expect(second).resolves.toBe(false);
  });
});
