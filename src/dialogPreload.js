const { ipcRenderer } = require("electron");

/**
 * Wires a modal dialog's close affordances (Close button and Esc key) to the
 * `dialog:close` IPC channel. Used by the About and shortcuts windows.
 */
document.addEventListener("DOMContentLoaded", () => {
  const closeButton = document.getElementById("dialog-close");
  if (closeButton) {
    closeButton.addEventListener("click", () => ipcRenderer.send("dialog:close"));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      ipcRenderer.send("dialog:close");
    }
  });
});
