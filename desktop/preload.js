const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aec", {
  info: () => ipcRenderer.invoke("aec:info"),
  pickFolder: () => ipcRenderer.invoke("aec:pick-folder"),
  openDataFolder: () => ipcRenderer.invoke("aec:open-data"),
  openExternal: (url) => ipcRenderer.invoke("aec:open-external", url),
});
