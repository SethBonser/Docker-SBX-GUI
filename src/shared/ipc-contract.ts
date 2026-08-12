// Single source of truth for IPC channel names shared by main, preload, and renderer.
// Command channels: ipcMain.handle <-> ipcRenderer.invoke (request/response).
// Stream channels: ipcMain pushes events keyed by a correlation id; renderer subscribes via ipcRenderer.on.

export const IPC = {
  appVersion: 'app:version',
  sbxHealth: 'sbx:health',
  sbxLs: 'sbx:ls',
  sbxCreate: 'sbx:create',
  sbxStop: 'sbx:stop',
  sbxStart: 'sbx:start',
  sbxRm: 'sbx:rm',
  sbxPortsList: 'sbx:ports:list',
  sbxPortsPublish: 'sbx:ports:publish',
  sbxPortsUnpublish: 'sbx:ports:unpublish',
  sbxKitInspect: 'sbx:kit:inspect',
  sbxKitValidate: 'sbx:kit:validate',
  dialogPickFolder: 'dialog:pickFolder',
  dialogPickKitReference: 'dialog:pickKitReference',
  chatStart: 'chat:start',
  chatSendMessage: 'chat:sendMessage',
  chatStop: 'chat:stop',
  chatEvent: 'chat:event',
  chatLoginClaude: 'chat:loginClaude',
  terminalStart: 'terminal:start',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize',
  terminalStop: 'terminal:stop',
  terminalData: 'terminal:data',
  settingsGetDefaultView: 'settings:getDefaultView',
  settingsSetDefaultView: 'settings:setDefaultView',
  settingsGetDefaultPermissionMode: 'settings:getDefaultPermissionMode',
  settingsSetDefaultPermissionMode: 'settings:setDefaultPermissionMode',
  sbxLogin: 'sbx:login',
  sbxLogout: 'sbx:logout',
  shellOpenExternal: 'shell:openExternal'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
