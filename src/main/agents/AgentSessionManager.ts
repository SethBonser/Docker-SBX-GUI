import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { AgentSessionEvent } from '@shared/types'
import type { AgentSessionAdapter } from './AgentSessionAdapter'
import { ClaudeStreamJsonAdapter } from './ClaudeStreamJsonAdapter'

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

  async ensureStarted(sandboxName: string, agent: string): Promise<void> {
    if (this.sessions.has(sandboxName)) return

    // Only Claude has a confirmed headless/structured protocol today; other agents get a
    // generic pty-based fallback adapter in a later milestone.
    if (agent !== 'claude') {
      throw new Error(`No chat adapter available yet for agent "${agent}".`)
    }

    const adapter = new ClaudeStreamJsonAdapter(sandboxName)
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
