import { create } from 'zustand'
import type { AgentSessionEvent } from '@shared/types'

export type ChatMessage =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      name: string
      input: unknown
      result?: string
      isError?: boolean
      resultPending: boolean
      blockedReason?: string
    }
  | { kind: 'error'; id: string; message: string }

export type SessionStatus = 'idle' | 'connecting' | 'ready' | 'exited'

interface ChatSessionState {
  messages: ChatMessage[]
  status: SessionStatus
}

interface ChatStoreState {
  sessions: Record<string, ChatSessionState>
  handleEvent: (sandboxName: string, event: AgentSessionEvent) => void
  addUserMessage: (sandboxName: string, text: string) => void
  ensureSession: (sandboxName: string) => void
}

function emptySession(): ChatSessionState {
  return { messages: [], status: 'idle' }
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `m${idCounter}`
}

export const useChatStore = create<ChatStoreState>((set) => ({
  sessions: {},

  ensureSession: (sandboxName) =>
    set((state) => {
      if (state.sessions[sandboxName]) return state
      return { sessions: { ...state.sessions, [sandboxName]: emptySession() } }
    }),

  addUserMessage: (sandboxName, text) =>
    set((state) => {
      const session = state.sessions[sandboxName] ?? emptySession()
      return {
        sessions: {
          ...state.sessions,
          [sandboxName]: {
            ...session,
            messages: [...session.messages, { kind: 'user', id: nextId(), text }]
          }
        }
      }
    }),

  handleEvent: (sandboxName, event) =>
    set((state) => {
      const session = state.sessions[sandboxName] ?? emptySession()
      const messages = session.messages
      let status = session.status

      switch (event.type) {
        case 'status':
          if (event.status === 'connecting') status = 'connecting'
          else if (event.status === 'ready') status = 'ready'
          else if (event.status === 'exited') status = 'exited'
          return { sessions: { ...state.sessions, [sandboxName]: { messages, status } } }

        case 'assistant_message':
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: {
                status,
                messages: [...messages, { kind: 'assistant', id: nextId(), text: event.text }]
              }
            }
          }

        case 'tool_use':
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: {
                status,
                messages: [
                  ...messages,
                  { kind: 'tool', id: event.id, name: event.name, input: event.input, resultPending: true }
                ]
              }
            }
          }

        case 'tool_result': {
          let found = false
          const updated = messages.map((m) => {
            if (m.kind === 'tool' && m.id === event.toolUseId) {
              found = true
              return { ...m, result: event.content, isError: event.isError, resultPending: false }
            }
            return m
          })
          if (!found) {
            updated.push({
              kind: 'tool',
              id: event.toolUseId || nextId(),
              name: 'unknown_tool',
              input: undefined,
              result: event.content,
              isError: event.isError,
              resultPending: false
            })
          }
          return { sessions: { ...state.sessions, [sandboxName]: { status, messages: updated } } }
        }

        case 'permission_denied': {
          let found = false
          const updated = messages.map((m) => {
            if (m.kind === 'tool' && m.id === event.toolUseId) {
              found = true
              return { ...m, blockedReason: event.reason, resultPending: false }
            }
            return m
          })
          if (!found) {
            updated.push({
              kind: 'tool',
              id: event.toolUseId || nextId(),
              name: event.toolName,
              input: undefined,
              resultPending: false,
              blockedReason: event.reason
            })
          }
          return { sessions: { ...state.sessions, [sandboxName]: { status, messages: updated } } }
        }

        case 'error':
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: {
                status,
                messages: [...messages, { kind: 'error', id: nextId(), message: event.message }]
              }
            }
          }

        default:
          return state
      }
    })
}))
