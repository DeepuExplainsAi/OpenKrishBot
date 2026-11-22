const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('krishDesktop', {
  version: () => ipcRenderer.invoke('update:version'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
});
