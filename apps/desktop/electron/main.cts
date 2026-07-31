import path from "node:path";

import { app, BrowserWindow, dialog, ipcMain } from "electron";

ipcMain.handle("dialog:select-las", async () => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: "LAS well logs", extensions: ["las"] }],
    properties: ["openFile"],
    title: "Import LAS well log",
  });

  return result.canceled ? null : (result.filePaths[0] ?? null);
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

void app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
