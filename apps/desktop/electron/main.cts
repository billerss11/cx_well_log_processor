import path from "node:path";

import { app, BrowserWindow, dialog, ipcMain } from "electron";

ipcMain.handle("dialog:select-well-log", async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      {
        name: "Supported well logs",
        extensions: ["las", "dlis", "xml", "epc", "cxlog"],
      },
      { name: "LAS", extensions: ["las"] },
      { name: "DLIS", extensions: ["dlis"] },
      { name: "WITSML", extensions: ["xml", "epc"] },
      { name: "CX Log", extensions: ["cxlog"] },
    ],
    properties: ["openFile"],
    title: "Open well log",
  });

  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("dialog:save-cxlog", async (_event, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: defaultName,
    filters: [{ name: "CX Log", extensions: ["cxlog"] }],
    title: "Save converted well log",
  });

  return result.canceled ? null : (result.filePath ?? null);
});

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, "..", "dist-renderer", "index.html"),
    );
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
