const { contextBridge, ipcRenderer } = require("electron");
let workspace;
let boardLease;
contextBridge.exposeInMainWorld("desktop", {
  board: {
    invoke:async(action,value)=>{boardLease??=ipcRenderer.invoke('boardLease');return ipcRenderer.invoke('board',action,value,await boardLease);},
    onChanged:listener=>{const handler=()=>listener();ipcRenderer.on('board-changed',handler);return()=>ipcRenderer.removeListener('board-changed',handler);},
    onSource:listener=>{const handler=(_event,id)=>listener(id);ipcRenderer.on('board-source',handler);return()=>ipcRenderer.removeListener('board-source',handler);}
  },
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
