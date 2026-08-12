import { BrowserWindow } from 'electron'
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

  isRunning(sandboxName: string): boolean {
    return this.sessions.get(sandboxName)?.isRunning() ?? false
  }
}

export const agentSessionManager = new AgentSessionManagerImpl()
