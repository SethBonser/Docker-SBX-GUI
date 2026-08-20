import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { IPC } from '@shared/ipc-contract'
import type { AgentSessionEvent, ClaudePermissionMode } from '@shared/types'
import type { AgentSessionAdapter } from './AgentSessionAdapter'
import { ClaudeStreamJsonAdapter } from './ClaudeStreamJsonAdapter'
import { CodexExecAdapter } from './CodexExecAdapter'
import { GeminiStreamAdapter } from './GeminiStreamAdapter'
import { DockerAgentAdapter } from './DockerAgentAdapter'

interface ChatEventPayload {
  sandboxName: string
  event: AgentSessionEvent
}

class AgentSessionManagerImpl {
  private sessions = new Map<string, AgentSessionAdapter>()

  private broadcast(sandboxName: string, event: AgentSessionEvent): void {
    // Agent errors (a CLI's own failure, a protocol hiccup) arrive as async events here, not as
    // IPC call rejections, so they'd never reach the toIpcError logging hook otherwise — log
    // them here instead, since these are exactly the kind of thing a tester's bug report would
    // otherwise only describe from memory.
    if (event.type === 'error') {
      log.error(`[chat:${sandboxName}] ${event.message}`)
    }
    const payload: ChatEventPayload = { sandboxName, event }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.chatEvent, payload)
    }
  }

  async ensureStarted(
    sandboxName: string,
    agent: string,
    permissionMode: ClaudePermissionMode = 'default'
  ): Promise<void> {
    if (this.sessions.has(sandboxName)) return

    // Claude, Codex, Gemini, and docker-agent all have confirmed headless/structured
    // protocols (each verified live — see the adapters themselves for the exact wire
    // format and gotchas). Every other agent gets a generic pty-based fallback adapter in
    // a later milestone; ChatPanel already shows a clear "basic mode" message for those.
    let adapter: AgentSessionAdapter
    if (agent === 'claude') {
      adapter = new ClaudeStreamJsonAdapter(sandboxName, permissionMode)
    } else if (agent === 'codex') {
      adapter = new CodexExecAdapter(sandboxName)
    } else if (agent === 'gemini') {
      adapter = new GeminiStreamAdapter(sandboxName)
    } else if (agent === 'docker-agent') {
      adapter = new DockerAgentAdapter(sandboxName)
    } else {
      throw new Error(`No chat adapter available yet for agent "${agent}".`)
    }

    adapter.onEvent((event) => this.broadcast(sandboxName, event))
    this.sessions.set(sandboxName, adapter)
    await adapter.start()
  }

  async sendMessage(sandboxName: string, text: string): Promise<void> {
    const adapter = this.sessions.get(sandboxName)
    if (!adapter) throw new Error(`No active chat session for sandbox "${sandboxName}".`)
    await adapter.sendMessage(text)
  }

  async stop(sandboxName: string): Promise<void> {
    const adapter = this.sessions.get(sandboxName)
    if (!adapter) return
    await adapter.stop()
    this.sessions.delete(sandboxName)
  }

  // Unlike stop(), deliberately does NOT remove the adapter from `sessions` — interrupting a
  // turn should leave the session (and, for Codex/Gemini/docker-agent, its resume/thread/session
  // id) intact for the next message, not end it. Each adapter's own interrupt() already knows
  // how to leave itself in a state where the next sendMessage() just works.
  async interrupt(sandboxName: string): Promise<void> {
    const adapter = this.sessions.get(sandboxName)
    if (!adapter) return
    await adapter.interrupt()
  }

  isRunning(sandboxName: string): boolean {
    return this.sessions.get(sandboxName)?.isRunning() ?? false
  }
}

export const agentSessionManager = new AgentSessionManagerImpl()
