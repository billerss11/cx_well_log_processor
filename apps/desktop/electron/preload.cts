import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("welllogDesktop", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
  },
});
