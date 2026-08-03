import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("welllogDesktop", {
  platform: process.platform,
  selectWellLogFile: () =>
    ipcRenderer.invoke("dialog:select-well-log") as Promise<string | null>,
  selectCxlogDestination: (defaultName: string) =>
    ipcRenderer.invoke(
      "dialog:save-cxlog",
      defaultName,
    ) as Promise<string | null>,
  versions: {
    electron: process.versions.electron,
  },
});
