import { contextBridge, ipcRenderer } from 'electron';
import type { Snapshot, UiApi, UiCommand } from '../shared/types';

/** Bridge for the UI window: send commands, receive snapshots. The UI never sees tokens. */
const api: UiApi = {
  login: () => ipcRenderer.send('ui:login'),
  command: (command: UiCommand) => ipcRenderer.send('ui:command', command),
  onSnapshot: (callback) => {
    ipcRenderer.on('ui:snapshot', (_event, snapshot: Snapshot) => callback(snapshot));
  },
  requestSnapshot: () => ipcRenderer.send('ui:request-snapshot'),
  reportError: (message, stack) => ipcRenderer.send('renderer:error', 'ui', message, stack),
};

contextBridge.exposeInMainWorld('ui', api);
