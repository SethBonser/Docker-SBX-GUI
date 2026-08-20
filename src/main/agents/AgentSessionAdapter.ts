import type { AgentSessionEvent, AgentType } from '@shared/types'

export interface AgentSessionAdapter {
  readonly agent: AgentType | string
  start(): Promise<void>
  sendMessage(text: string): Promise<void>
  onEvent(handler: (e: AgentSessionEvent) => void): () => void
  stop(): Promise<void>
  // Aborts the turn currently in flight, if any, without ending the session the way stop()
  // does — for the one-shot adapters (Codex/Gemini/docker-agent) this is identical to stop()
  // (kill the in-flight child; the next sendMessage() spawns a fresh one, same as always), but
  // for Claude's persistent process it's a forceful kill rather than stop()'s graceful stdin-end,
  // since the whole point is stopping generation *now*. The adapter instance stays registered
  // either way — Claude's own sendMessage() already restarts a fresh child if it finds none
  // running, so no separate restart step is needed after interrupting.
  interrupt(): Promise<void>
  isRunning(): boolean
}
