import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '@shared/ipc-contract'
import type {
  AgentSessionEvent,
  ClaudePermissionMode,
  CreateSandboxOptions,
  DefaultView,
  HealthStatus,
  KitDetails,
  KitValidationResult,
  PortMapping,
  PtyLoginResult,
  SandboxSummary
} from '@shared/types'

interface ChatEventPayload {
  sandboxName: string
  event: AgentSessionEvent
}

interface TerminalDataPayload {
  sandboxName: string
  data: string
}

// Narrow, typed surface exposed to the renderer. Never expose raw ipcRenderer.
const sbxApi = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(IPC.appVersion),
  getHealth: (): Promise<HealthStatus> => ipcRenderer.invoke(IPC.sbxHealth),
  listSandboxes: (): Promise<SandboxSummary[]> => ipcRenderer.invoke(IPC.sbxLs),
  createSandbox: (opts: CreateSandboxOptions): Promise<void> => ipcRenderer.invoke(IPC.sbxCreate, opts),
  stopSandboxes: (names: string[]): Promise<void> => ipcRenderer.invoke(IPC.sbxStop, names),
  startSandbox: (name: string): Promise<void> => ipcRenderer.invoke(IPC.sbxStart, name),
  removeSandboxes: (names: string[]): Promise<void> => ipcRenderer.invoke(IPC.sbxRm, names),
  listPorts: (sandboxName: string): Promise<PortMapping[]> =>
    ipcRenderer.invoke(IPC.sbxPortsList, sandboxName),
  publishPort: (sandboxName: string, spec: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxPortsPublish, sandboxName, spec),
  unpublishPort: (sandboxName: string, spec: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxPortsUnpublish, sandboxName, spec),
  kitInspect: (reference: string): Promise<KitDetails> => ipcRenderer.invoke(IPC.sbxKitInspect, reference),
  kitValidate: (reference: string): Promise<KitValidationResult> =>
    ipcRenderer.invoke(IPC.sbxKitValidate, reference),
  pickWorkspaceFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogPickFolder),
  pickKitReference: (): Promise<string | null> => ipcRenderer.invoke(IPC.dialogPickKitReference),
  startChatSession: (
    sandboxName: string,
    agent: string,
    permissionMode?: ClaudePermissionMode
  ): Promise<void> => ipcRenderer.invoke(IPC.chatStart, sandboxName, agent, permissionMode),
  sendChatMessage: (sandboxName: string, text: string): Promise<void> =>
    ipcRenderer.invoke(IPC.chatSendMessage, sandboxName, text),
  stopChatSession: (sandboxName: string): Promise<void> => ipcRenderer.invoke(IPC.chatStop, sandboxName),
  loginClaude: (sandboxName: string): Promise<PtyLoginResult> =>
    ipcRenderer.invoke(IPC.chatLoginClaude, sandboxName),
  onChatEvent: (sandboxName: string, handler: (event: AgentSessionEvent) => void): (() => void) => {
    const listener = (_: unknown, payload: ChatEventPayload): void => {
      if (payload.sandboxName === sandboxName) handler(payload.event)
    }
    ipcRenderer.on(IPC.chatEvent, listener)
    return () => ipcRenderer.removeListener(IPC.chatEvent, listener)
  },
  login: (): Promise<void> => ipcRenderer.invoke(IPC.sbxLogin),
  logout: (): Promise<void> => ipcRenderer.invoke(IPC.sbxLogout),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.shellOpenExternal, url),
  startTerminal: (sandboxName: string): Promise<void> => ipcRenderer.invoke(IPC.terminalStart, sandboxName),
  sendTerminalInput: (sandboxName: string, data: string): Promise<void> =>
    ipcRenderer.invoke(IPC.terminalInput, sandboxName, data),
  resizeTerminal: (sandboxName: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke(IPC.terminalResize, sandboxName, cols, rows),
  stopTerminal: (sandboxName: string): Promise<void> => ipcRenderer.invoke(IPC.terminalStop, sandboxName),
  onTerminalData: (sandboxName: string, handler: (data: string) => void): (() => void) => {
    const listener = (_: unknown, payload: TerminalDataPayload): void => {
      if (payload.sandboxName === sandboxName) handler(payload.data)
    }
    ipcRenderer.on(IPC.terminalData, listener)
    return () => ipcRenderer.removeListener(IPC.terminalData, listener)
  },
  getDefaultView: (): Promise<DefaultView> => ipcRenderer.invoke(IPC.settingsGetDefaultView),
  setDefaultView: (view: DefaultView): Promise<void> =>
    ipcRenderer.invoke(IPC.settingsSetDefaultView, view),
  getDefaultPermissionMode: (): Promise<ClaudePermissionMode> =>
    ipcRenderer.invoke(IPC.settingsGetDefaultPermissionMode),
  setDefaultPermissionMode: (mode: ClaudePermissionMode): Promise<void> =>
    ipcRenderer.invoke(IPC.settingsSetDefaultPermissionMode, mode)
}

export type SbxApi = typeof sbxApi

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('sbxApi', sbxApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.sbxApi = sbxApi
}
