import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '@shared/ipc-contract'
import type {
  AgentSessionEvent,
  ClaudePermissionMode,
  CreateSandboxOptions,
  DefaultView,
  DiagnoseResult,
  HealthStatus,
  KitDetails,
  KitLibraryEntry,
  KitSourceType,
  KitValidationResult,
  McpAddOptions,
  McpAuthStatus,
  McpServerDetails,
  McpServerSummary,
  PasswordManagerId,
  PasswordManagerInfo,
  PolicyLogResult,
  PolicyRule,
  PolicyTier,
  PortMapping,
  PtyLoginResult,
  SandboxSummary,
  SecretEntry
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
  kitAdd: (sandboxName: string, reference: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxKitAdd, sandboxName, reference),
  listKitLibrary: (): Promise<KitLibraryEntry[]> => ipcRenderer.invoke(IPC.kitLibraryList),
  recordKitUsage: (opts: {
    reference: string
    sourceType: KitSourceType
    manifest: KitDetails
    sandboxName: string
  }): Promise<void> => ipcRenderer.invoke(IPC.kitLibraryRecordUsage, opts),
  removeKitLibraryEntry: (id: string): Promise<void> => ipcRenderer.invoke(IPC.kitLibraryRemove, id),
  policyList: (sandboxName?: string): Promise<PolicyRule[]> =>
    ipcRenderer.invoke(IPC.sbxPolicyList, sandboxName),
  policyAllowNetwork: (resources: string, sandboxName?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxPolicyAllowNetwork, resources, sandboxName),
  policyDenyNetwork: (resources: string, sandboxName?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxPolicyDenyNetwork, resources, sandboxName),
  policyRemoveNetwork: (opts: { id?: string; resource?: string; sandboxName?: string }): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxPolicyRemoveNetwork, opts),
  policyLog: (sandboxName?: string, limit?: number): Promise<PolicyLogResult> =>
    ipcRenderer.invoke(IPC.sbxPolicyLog, sandboxName, limit),
  policyInit: (tier: PolicyTier): Promise<void> => ipcRenderer.invoke(IPC.sbxPolicyInit, tier),
  policyReset: (): Promise<void> => ipcRenderer.invoke(IPC.sbxPolicyReset),
  getLastAppliedPolicyTier: (): Promise<PolicyTier | null> =>
    ipcRenderer.invoke(IPC.settingsGetLastAppliedPolicyTier),
  mcpList: (): Promise<McpServerSummary[]> => ipcRenderer.invoke(IPC.sbxMcpList),
  mcpInspect: (name: string): Promise<McpServerDetails> => ipcRenderer.invoke(IPC.sbxMcpInspect, name),
  mcpAdd: (name: string, opts: McpAddOptions): Promise<void> => ipcRenderer.invoke(IPC.sbxMcpAdd, name, opts),
  mcpAuth: (name: string): Promise<void> => ipcRenderer.invoke(IPC.sbxMcpAuth, name),
  mcpAuthStatus: (): Promise<McpAuthStatus[]> => ipcRenderer.invoke(IPC.sbxMcpAuthStatus),
  mcpAuthRemove: (name: string): Promise<void> => ipcRenderer.invoke(IPC.sbxMcpAuthRemove, name),
  mcpRemove: (name: string): Promise<void> => ipcRenderer.invoke(IPC.sbxMcpRemove, name),
  mcpLoad: (name: string, sandboxName: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxMcpLoad, name, sandboxName),
  secretList: (opts?: { global?: boolean; sandboxName?: string; service?: string }): Promise<SecretEntry[]> =>
    ipcRenderer.invoke(IPC.sbxSecretList, opts ?? {}),
  secretSet: (service: string, value: string, opts?: { sandboxName?: string }): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxSecretSet, service, value, opts ?? {}),
  secretSetOAuth: (service: string): Promise<void> => ipcRenderer.invoke(IPC.sbxSecretSetOAuth, service),
  secretSetFromPasswordManager: (
    service: string,
    managerId: PasswordManagerId,
    reference: string,
    opts?: { sandboxName?: string }
  ): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxSecretSetFromPasswordManager, service, managerId, reference, opts ?? {}),
  listPasswordManagers: (): Promise<PasswordManagerInfo[]> => ipcRenderer.invoke(IPC.sbxPasswordManagerList),
  secretRemove: (service: string, opts?: { sandboxName?: string }): Promise<void> =>
    ipcRenderer.invoke(IPC.sbxSecretRemove, service, opts ?? {}),
  daemonStart: (): Promise<void> => ipcRenderer.invoke(IPC.sbxDaemonStart),
  daemonStop: (): Promise<void> => ipcRenderer.invoke(IPC.sbxDaemonStop),
  daemonRestart: (): Promise<void> => ipcRenderer.invoke(IPC.sbxDaemonRestart),
  diagnose: (): Promise<DiagnoseResult> => ipcRenderer.invoke(IPC.sbxDiagnose),
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
