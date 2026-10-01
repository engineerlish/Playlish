import { contextBridge, ipcRenderer } from 'electron';
import type { HostApi, PlayerCommand } from '../shared/types';

/** Bridge for the hidden playback host page: it can fetch a token for the SDK and report state; nothing else. */
const api: HostApi = {
  getToken: () => ipcRenderer.invoke('host:get-token') as Promise<string>,
  ready: (deviceId) => ipcRenderer.send('host:ready', deviceId),
  state: (state) => ipcRenderer.send('host:state', state),
  error: (kind, message) => ipcRenderer.send('host:error', kind, message),
  log: (message) => ipcRenderer.send('host:log', message),
  onCommand: (callback) => {
    ipcRenderer.on('host:command', (_event, command: PlayerCommand) => callback(command));
  },
};

contextBridge.exposeInMainWorld('host', api);
