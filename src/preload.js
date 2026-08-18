const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getVersion: () => ipcRenderer.invoke('app:version'),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  setGameViewState: (state) => ipcRenderer.invoke('game:view-state', state),
  reloadGame: () => ipcRenderer.invoke('game:reload'),
  loadGame: (url) => ipcRenderer.invoke('game:load', url),
  onGameLayoutRequest: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('game:request-layout', handler);
    return () => ipcRenderer.removeListener('game:request-layout', handler);
  }
});
