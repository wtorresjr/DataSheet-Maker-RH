// The renderer's only bridge to the main process. contextIsolation is on and
// nodeIntegration off — the renderer never touches Node directly.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rhAPI", {
  // Last scraped plan, or null. Same payload shape the extension kept in
  // chrome.storage.local under "rhDataSheet".
  getPlan: () => ipcRenderer.invoke("plan:get"),

  // Forget the stored plan so the next launch starts empty.
  clearPlan: () => ipcRenderer.invoke("plan:clear"),

  // Runs the extraction against the <webview> with this webContents id.
  // -> { ok: true, payload, method: "database"|"dom" } | { ok: false, error }
  scrapePlan: (ravenWebContentsId) =>
    ipcRenderer.invoke("plan:scrape", ravenWebContentsId),

  onProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("plan:progress", handler);
    return () => ipcRenderer.off("plan:progress", handler);
  },

  print: () => ipcRenderer.invoke("sheet:print"),
  savePdf: (clientId) => ipcRenderer.invoke("sheet:pdf", clientId),
});
