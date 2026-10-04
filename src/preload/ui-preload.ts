import { contextBridge, ipcRenderer } from 'electron';
import type { ActionResult, LibraryResult, QueueResult, Snapshot, UiApi, UiCommand } from '../shared/types';

/** Bridge for the UI window: send commands, receive snapshots. The UI never sees tokens. */
const api: UiApi = {
  login: () => ipcRenderer.send('ui:login'),
  command: (command: UiCommand) => ipcRenderer.send('ui:command', command),
  onSnapshot: (callback) => {
    ipcRenderer.on('ui:snapshot', (_event, snapshot: Snapshot) => callback(snapshot));
  },
  requestSnapshot: () => ipcRenderer.send('ui:request-snapshot'),
  navigate: (page) => ipcRenderer.send('ui:navigate', page),
  refreshDevices: () => ipcRenderer.send('ui:devices-refresh'),
  transfer: (deviceId) => ipcRenderer.send('ui:transfer', deviceId),
  setPreference: (key, value) => ipcRenderer.send('ui:set-preference', key, value),
  openUpdate: () => ipcRenderer.send('ui:open-update'),
  restart: (safeMode) => ipcRenderer.send('ui:restart', safeMode),
  library: (list, offset) => ipcRenderer.invoke('ui:library', list, offset) as Promise<LibraryResult>,
  libraryAction: (action) => ipcRenderer.invoke('ui:library-action', action) as Promise<ActionResult>,
  search: (query, kind, offset) => ipcRenderer.invoke('ui:search', query, kind, offset) as Promise<LibraryResult>,
  queue: () => ipcRenderer.invoke('ui:queue') as Promise<QueueResult>,
  setup: (action) => ipcRenderer.send('ui:setup', action),
  signOut: () => ipcRenderer.send('ui:sign-out'),
  exportDiagnostics: () => ipcRenderer.send('ui:export-diagnostics'),
  reportIssue: () => ipcRenderer.send('ui:report-issue'),
  answerCrashNotice: (action) => ipcRenderer.send('ui:crash-notice', action),
  reportError: (message, stack) => ipcRenderer.send('renderer:error', 'ui', message, stack),
};

contextBridge.exposeInMainWorld('ui', api);
