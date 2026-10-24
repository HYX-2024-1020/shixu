const { contextBridge, ipcRenderer } = require("electron");
let workspace;
contextBridge.exposeInMainWorld("desktop", {
  store: async (method, value) => {
    workspace ??= ipcRenderer.invoke("workspace");
    return ipcRenderer.invoke("store", method, value, await workspace);
  },
  cloud: (action, value) => ipcRenderer.invoke("cloud", action, value),
  key: (action, value) => ipcRenderer.invoke("key", action, value),
  backup: (action) => ipcRenderer.invoke("backup", action),
  archive: (bytes, extension) =>
    ipcRenderer.invoke("archive", bytes, extension),
  office: (bytes, extension) => ipcRenderer.invoke("office", bytes, extension),
});
