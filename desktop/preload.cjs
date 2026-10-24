const { contextBridge, ipcRenderer } = require('electron');
async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    // Keep the native explanation without exposing Electron's transport wrapper in the UI.
    throw new Error(
      error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''),
      { cause: error },
    );
  }
}
contextBridge.exposeInMainWorld('networkToolbox', {
  call: (method, params) => invoke('toolbox:call', method, params),
  onEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('toolbox:event', listener);
    return () => ipcRenderer.removeListener('toolbox:event', listener);
  },
  exportRecord: (id, kind) => invoke('toolbox:export', id, kind),
  openExternal: (url) => invoke('toolbox:open', url),
  window: (action) => invoke('toolbox:window', action),
  getWindowPreferences: () => invoke('toolbox:preferences', 'get'),
  setWindowPreferences: (preferences) => invoke('toolbox:preferences', 'set', preferences),
});
