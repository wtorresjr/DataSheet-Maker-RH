// RH DataSheet Maker — Electron main process.
const path = require("node:path");
const { app, BrowserWindow, session, shell } = require("electron");
const ipc = require("./ipc");

const RAVEN_PARTITION = "persist:raven";
const RAVEN_ORIGIN = "https://app.ravenhealth.com";

// Electron's default UA advertises "Electron/x.y.z"; sites that gate on
// browser support can reject it. Present as stock desktop Chrome instead.
const chromeVersion = process.versions.chrome;
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  `Chrome/${chromeVersion} Safari/537.36`;

let mainWindow = null;

function configureRavenSession() {
  const ravenSession = session.fromPartition(RAVEN_PARTITION);
  ravenSession.setUserAgent(CHROME_UA);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    title: "RH DataSheet Maker",
    icon: path.join(__dirname, "..", "..", "icons", "icon128.png"),
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

// Chromium persists devtools open/closed state per session partition, so a
// partition that ever had devtools opened reopens them on every future window.
// Force them shut on the embedded Raven view.
function suppressInheritedDevTools(contents) {
  contents.closeDevTools();
  contents.once("dom-ready", () => contents.closeDevTools());
}

app.on("web-contents-created", (_event, contents) => {
  if (contents.getType() !== "webview") return;

  suppressInheritedDevTools(contents);

  // Keep the embedded view pinned to Raven; anything else opens in the real
  // browser rather than turning this window into a general-purpose browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(RAVEN_ORIGIN)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
});

app.whenReady().then(() => {
  configureRavenSession();
  ipc.register(() => mainWindow);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
