const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  store: (method, value) => ipcRenderer.invoke("store", method, value),
  key: (action, value) => ipcRenderer.invoke("key", action, value),
  backup: (action) => ipcRenderer.invoke("backup", action),
  archive: (bytes, extension) =>
    ipcRenderer.invoke("archive", bytes, extension),
  office: (bytes, extension) => ipcRenderer.invoke("office", bytes, extension),
});
