const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aec", {
  info: () => ipcRenderer.invoke("aec:info"),
  openDataFolder: () => ipcRenderer.invoke("aec:open-data"),
  openExternal: (url) => ipcRenderer.invoke("aec:open-external", url),
});
