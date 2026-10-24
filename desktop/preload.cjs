const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('networkToolbox', {
  call: (method, params) => ipcRenderer.invoke('toolbox:call', method, params),
  onEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('toolbox:event', listener);
    return () => ipcRenderer.removeListener('toolbox:event', listener);
  },
  exportRecord: (id, kind) => ipcRenderer.invoke('toolbox:export', id, kind),
  openExternal: (url) => ipcRenderer.invoke('toolbox:open', url),
  window: (action) => ipcRenderer.invoke('toolbox:window', action),
});
