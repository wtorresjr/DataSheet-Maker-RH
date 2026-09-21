// IPC surface backing window.rhAPI (see src/preload/preload.js).
const { ipcMain, webContents } = require("electron");
const { extractPlan } = require("./extract");
const { loadPlan, savePlan, clearPlan } = require("./store");
const { printSheet, savePdf } = require("./print");

function register(getWindow) {
  ipcMain.handle("plan:get", () => loadPlan());

  ipcMain.handle("plan:clear", () => {
    clearPlan();
    return { ok: true };
  });

  // The renderer passes its <webview>'s id; the scrape runs against that
  // webContents, which is where Raven is actually loaded.
  ipcMain.handle("plan:scrape", async (event, ravenWebContentsId) => {
    const raven = webContents.fromId(ravenWebContentsId);
    if (!raven) return { ok: false, error: "The Raven view is not available." };

    try {
      const { payload, method, renderedCount, fallbackReason } = await extractPlan(
        raven,
        (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("plan:progress", progress);
          }
        },
      );
      savePlan(payload);
      return { ok: true, payload, method, renderedCount, fallbackReason };
    } catch (err) {
      console.error("Plan extraction failed:", err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("sheet:print", async () => {
    const win = getWindow();
    if (!win) return { printed: false };
    return printSheet(win.webContents);
  });

  ipcMain.handle("sheet:pdf", async (_event, clientId) => {
    const win = getWindow();
    if (!win) return { path: null };
    try {
      return await savePdf(win, clientId);
    } catch (err) {
      console.error("PDF export failed:", err);
      return { path: null, error: err.message };
    }
  });
}

module.exports = { register };
