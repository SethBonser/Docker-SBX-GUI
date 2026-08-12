import type { AgentSessionEvent, AgentType } from '@shared/types'

export interface AgentSessionAdapter {
  readonly agent: AgentType | string
  start(): Promise<void>
  sendMessage(text: string): Promise<void>
  onEvent(handler: (e: AgentSessionEvent) => void): () => void
  stop(): Promise<void>
  isRunning(): boolean
}
