import { app, ipcMain, BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { CreateSandboxOptions } from '@shared/types'
import { sbxCli } from '../sbx/sbxCli'
import { probeHealth } from '../sbx/health'
import { SbxCliError } from '../sbx/errors'
import { pickWorkspaceFolder, pickKitReference } from '../dialogs'
import { agentSessionManager } from '../agents/AgentSessionManager'
import { loginClaudeViaPty } from '../agents/claudePtyLogin'

/** Re-throw plain, serializable errors so renderer catch blocks get useful info back over IPC. */
function toIpcError(err: unknown): Error {
  if (err instanceof SbxCliError) {
    return new Error(`[${err.kind}] ${err.message}`)
  }
  return err instanceof Error ? err : new Error(String(err))
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

  ipcMain.handle(IPC.dialogPickFolder, async (event) => {
    return pickWorkspaceFolder(activeWindow(event))
  })

  ipcMain.handle(IPC.dialogPickKitReference, async (event) => {
    return pickKitReference(activeWindow(event))
  })

  ipcMain.handle(IPC.chatStart, async (_event, sandboxName: string, agent: string) => {
    await agentSessionManager.ensureStarted(sandboxName, agent)
  })

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

  ipcMain.handle(IPC.shellOpenExternal, async (_event, url: string) => {
    // Defense in depth: this channel should only ever receive our own hardcoded links or a
    // URL scraped from sbx's own OAuth output, but only allow https to be safe regardless.
    if (!/^https:\/\//.test(url)) throw new Error('Refusing to open a non-https URL.')
    await shell.openExternal(url)
  })
}
