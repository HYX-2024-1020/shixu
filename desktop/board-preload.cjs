const { contextBridge, ipcRenderer } = require("electron");
let lease;
contextBridge.exposeInMainWorld("boardHost", {
  invoke: async (action, value) => {
    lease ??= ipcRenderer.invoke("boardLease");
    return ipcRenderer.invoke("board", action, value, await lease);
  },
  onChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("board-changed", handler);
    return () => ipcRenderer.removeListener("board-changed", handler);
  },
});
