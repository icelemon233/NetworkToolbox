const { contextBridge, ipcRenderer } = require('electron');
const startupArguments = typeof process === 'undefined' ? [] : process.argv;
const bootstrap =
  typeof ipcRenderer.sendSync === 'function' ? ipcRenderer.sendSync('toolbox:startup') : null;
const initialTheme =
  bootstrap?.theme ??
  startupArguments
    .find((argument) => argument.startsWith('--toolbox-initial-theme='))
    ?.split('=')[1];
const nativeTheme =
  bootstrap?.nativeTheme ??
  startupArguments
    .find((argument) => argument.startsWith('--toolbox-native-theme='))
    ?.split('=')[1];
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
  uiQa: bootstrap?.uiQa === true || startupArguments.includes('--toolbox-ui-qa'),
  initialTheme: ['system', 'light', 'dark'].includes(initialTheme) ? initialTheme : undefined,
  nativeTheme: ['light', 'dark'].includes(nativeTheme) ? nativeTheme : undefined,
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
