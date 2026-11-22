const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceCallWindow', {
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app:voice-call-state', listener);
    return () => ipcRenderer.removeListener('app:voice-call-state', listener);
  },
  control: (action) => ipcRenderer.invoke('app:voice-call-window-control', action),
  action: (action) => ipcRenderer.invoke('app:voice-call-action', action),
});
