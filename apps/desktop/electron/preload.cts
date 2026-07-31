import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("welllogDesktop", {
  platform: process.platform,
  selectLasFile: () =>
    ipcRenderer.invoke("dialog:select-las") as Promise<string | null>,
  versions: {
    electron: process.versions.electron,
  },
});
