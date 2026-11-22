const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('krishDesktop', {
  version: () => ipcRenderer.invoke('update:version'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  onUpdateStatus: (listener) => { const h = (_e, s) => listener(s); ipcRenderer.on('update:status', h); return () => ipcRenderer.removeListener('update:status', h); },
  dismissUpdate: (v) => ipcRenderer.invoke('update:dismiss', v),
  retryUpdate: (id) => ipcRenderer.invoke('update:retry', id),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  restartUpdate: () => ipcRenderer.invoke('update:restart'),
});
