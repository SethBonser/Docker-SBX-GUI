import { app, ipcMain, BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import { IPC } from '@shared/ipc-contract'
import type { CreateSandboxOptions } from '@shared/types'
import { sbxCli } from '../sbx/sbxCli'
import { probeHealth } from '../sbx/health'
import { SbxCliError } from '../sbx/errors'
import { pickWorkspaceFolder, pickKitReference } from '../dialogs'
import { exportLogs } from '../logExport'
import { agentSessionManager } from '../agents/AgentSessionManager'
import { loginClaudeViaPty } from '../agents/claudePtyLogin'
import { terminalSessionManager } from '../agents/TerminalSessionManager'
import { listPasswordManagers } from '../passwordManager'
import { recordKitUsage, listKitLibrary, removeKitLibraryEntry } from '../kitLibrary'
import {
  getDefaultView,
  setDefaultView,
  getDefaultPermissionMode,
  setDefaultPermissionMode,
  getLastAppliedPolicyTier,
  setLastAppliedPolicyTier
} from '../settings'
import type {
  ClaudePermissionMode,
  DefaultView,
  KitDetails,
  KitSourceType,
  McpAddOptions,
  PasswordManagerId,
  PolicyTier
} from '@shared/types'

/**
 * Re-throw plain, serializable errors so renderer catch blocks get useful info back over IPC —
 * and log every one of them, so a failure a tester saw inline in the UI also has a real stack
 * trace / stderr detail sitting in the exportable log file, not just whatever short message
 * happened to render on screen.
 */
function toIpcError(err: unknown): Error {
  if (err instanceof SbxCliError) {
    log.error(`[${err.kind}] ${err.message}`, err.stderr ? `\nstderr: ${err.stderr}` : '')
    return new Error(`[${err.kind}] ${err.message}`)
  }
  const error = err instanceof Error ? err : new Error(String(err))
  log.error(error.message, error.stack)
  return error
}

function activeWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0]
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.appVersion, () => app.getVersion())

  ipcMain.handle(IPC.sbxHealth, async () => probeHealth())

  ipcMain.handle(IPC.sbxLs, async () => {
    try {
      return await sbxCli.ls()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxCreate, async (_event, opts: CreateSandboxOptions) => {
    try {
      await sbxCli.create(opts)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxStop, async (_event, names: string[]) => {
    try {
      await sbxCli.stop(names)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxStart, async (_event, name: string) => {
    try {
      await sbxCli.start(name)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxRm, async (_event, names: string[]) => {
    try {
      await sbxCli.rm(names)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxPortsList, async (_event, sandboxName: string) => {
    try {
      return await sbxCli.listPorts(sandboxName)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxPortsPublish, async (_event, sandboxName: string, spec: string) => {
    try {
      await sbxCli.publishPort(sandboxName, spec)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxPortsUnpublish, async (_event, sandboxName: string, spec: string) => {
    try {
      await sbxCli.unpublishPort(sandboxName, spec)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxKitInspect, async (_event, reference: string) => {
    try {
      return await sbxCli.kitInspect(reference)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxKitValidate, async (_event, reference: string) => {
    return sbxCli.kitValidate(reference)
  })

  ipcMain.handle(IPC.sbxKitAdd, async (_event, sandboxName: string, reference: string) => {
    try {
      await sbxCli.kitAdd(sandboxName, reference)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.kitLibraryList, async () => {
    try {
      return listKitLibrary()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(
    IPC.kitLibraryRecordUsage,
    async (
      _event,
      opts: { reference: string; sourceType: KitSourceType; manifest: KitDetails; sandboxName: string }
    ) => {
      try {
        await recordKitUsage(opts)
      } catch (err) {
        throw toIpcError(err)
      }
    }
  )

  ipcMain.handle(IPC.kitLibraryRemove, async (_event, id: string) => {
    try {
      await removeKitLibraryEntry(id)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxPolicyList, async (_event, sandboxName?: string) => {
    try {
      return await sbxCli.policyList(sandboxName)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxPolicyAllowNetwork, async (_event, resources: string, sandboxName?: string) => {
    try {
      await sbxCli.policyAllowNetwork(resources, sandboxName)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxPolicyDenyNetwork, async (_event, resources: string, sandboxName?: string) => {
    try {
      await sbxCli.policyDenyNetwork(resources, sandboxName)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(
    IPC.sbxPolicyRemoveNetwork,
    async (_event, opts: { id?: string; resource?: string; sandboxName?: string }) => {
      try {
        await sbxCli.policyRemoveNetwork(opts)
      } catch (err) {
        throw toIpcError(err)
      }
    }
  )

  ipcMain.handle(IPC.sbxPolicyLog, async (_event, sandboxName?: string, limit?: number) => {
    try {
      return await sbxCli.policyLog(sandboxName, limit)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxPolicyInit, async (_event, tier: PolicyTier) => {
    try {
      await sbxCli.policyInit(tier)
      // sbx exposes no way to query the active tier later, so this is our only record of it —
      // and only accurate for tiers applied through this app's own switcher.
      setLastAppliedPolicyTier(tier)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxPolicyReset, async () => {
    try {
      await sbxCli.policyReset()
      setLastAppliedPolicyTier(null)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.settingsGetLastAppliedPolicyTier, () => getLastAppliedPolicyTier())

  ipcMain.handle(IPC.sbxMcpList, async () => {
    try {
      return await sbxCli.mcpList()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxMcpInspect, async (_event, name: string) => {
    try {
      return await sbxCli.mcpInspect(name)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxMcpAdd, async (_event, name: string, opts: McpAddOptions) => {
    try {
      await sbxCli.mcpAdd(name, opts)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxMcpAuth, async (_event, name: string) => {
    try {
      await sbxCli.mcpAuth(name)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxMcpAuthStatus, async () => {
    try {
      return await sbxCli.mcpAuthStatus()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxMcpAuthRemove, async (_event, name: string) => {
    try {
      await sbxCli.mcpAuthRemove(name)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxMcpRemove, async (_event, name: string) => {
    try {
      await sbxCli.mcpRemove(name)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxMcpLoad, async (_event, name: string, sandboxName: string) => {
    try {
      await sbxCli.mcpLoad(name, sandboxName)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(
    IPC.sbxSecretList,
    async (_event, opts: { global?: boolean; sandboxName?: string; service?: string }) => {
      try {
        return await sbxCli.secretList(opts)
      } catch (err) {
        throw toIpcError(err)
      }
    }
  )

  ipcMain.handle(
    IPC.sbxSecretSet,
    async (_event, service: string, value: string, opts: { sandboxName?: string }) => {
      try {
        await sbxCli.secretSet(service, value, opts)
      } catch (err) {
        throw toIpcError(err)
      }
    }
  )

  ipcMain.handle(IPC.sbxSecretSetOAuth, async (_event, service: string) => {
    try {
      await sbxCli.secretSetOAuth(service)
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(
    IPC.sbxSecretSetFromPasswordManager,
    async (
      _event,
      service: string,
      managerId: PasswordManagerId,
      reference: string,
      opts: { sandboxName?: string }
    ) => {
      try {
        await sbxCli.secretSetFromPasswordManager(service, managerId, reference, opts)
      } catch (err) {
        throw toIpcError(err)
      }
    }
  )

  ipcMain.handle(IPC.sbxPasswordManagerList, async () => {
    try {
      return await listPasswordManagers()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(
    IPC.sbxSecretRemove,
    async (_event, service: string, opts: { sandboxName?: string }) => {
      try {
        await sbxCli.secretRemove(service, opts)
      } catch (err) {
        throw toIpcError(err)
      }
    }
  )

  ipcMain.handle(IPC.sbxDaemonStart, async () => {
    try {
      await sbxCli.daemonStart()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxDaemonStop, async () => {
    try {
      await sbxCli.daemonStop()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxDaemonRestart, async () => {
    try {
      await sbxCli.daemonRestart()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxDiagnose, async () => {
    try {
      return await sbxCli.diagnose()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.logsExport, async (event) => {
    try {
      return await exportLogs(activeWindow(event))
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.dialogPickFolder, async (event) => {
    return pickWorkspaceFolder(activeWindow(event))
  })

  ipcMain.handle(IPC.dialogPickKitReference, async (event) => {
    return pickKitReference(activeWindow(event))
  })

  ipcMain.handle(
    IPC.chatStart,
    async (_event, sandboxName: string, agent: string, permissionMode?: ClaudePermissionMode) => {
      await agentSessionManager.ensureStarted(sandboxName, agent, permissionMode)
    }
  )

  ipcMain.handle(IPC.chatSendMessage, async (_event, sandboxName: string, text: string) => {
    await agentSessionManager.sendMessage(sandboxName, text)
  })

  ipcMain.handle(IPC.chatStop, async (_event, sandboxName: string) => {
    await agentSessionManager.stop(sandboxName)
  })

  ipcMain.handle(IPC.chatLoginClaude, async (_event, sandboxName: string) => {
    return loginClaudeViaPty(sandboxName)
  })

  ipcMain.handle(IPC.sbxLogin, async () => {
    try {
      await sbxCli.login()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.sbxLogout, async () => {
    try {
      await sbxCli.logout()
    } catch (err) {
      throw toIpcError(err)
    }
  })

  ipcMain.handle(IPC.terminalStart, async (_event, sandboxName: string) => {
    await terminalSessionManager.ensureStarted(sandboxName)
  })

  ipcMain.handle(IPC.terminalInput, (_event, sandboxName: string, data: string) => {
    terminalSessionManager.write(sandboxName, data)
  })

  ipcMain.handle(IPC.terminalResize, (_event, sandboxName: string, cols: number, rows: number) => {
    terminalSessionManager.resize(sandboxName, cols, rows)
  })

  ipcMain.handle(IPC.terminalStop, (_event, sandboxName: string) => {
    terminalSessionManager.stop(sandboxName)
  })

  ipcMain.handle(IPC.settingsGetDefaultPermissionMode, () => getDefaultPermissionMode())

  ipcMain.handle(IPC.settingsSetDefaultPermissionMode, (_event, mode: ClaudePermissionMode) => {
    setDefaultPermissionMode(mode)
  })

  ipcMain.handle(IPC.settingsGetDefaultView, () => getDefaultView())

  ipcMain.handle(IPC.settingsSetDefaultView, (_event, view: DefaultView) => {
    setDefaultView(view)
  })

  ipcMain.handle(IPC.shellOpenExternal, async (_event, url: string) => {
    // Defense in depth: this channel should only ever receive our own hardcoded links or a
    // URL scraped from sbx's own OAuth output, but only allow https to be safe regardless.
    if (!/^https:\/\//.test(url)) throw new Error('Refusing to open a non-https URL.')
    await shell.openExternal(url)
  })
}
