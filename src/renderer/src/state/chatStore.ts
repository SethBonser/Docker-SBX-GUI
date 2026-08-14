import { useEffect } from 'react'
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
  mcpServers: { name: string; status: string }[]
  // True from the moment a user message is sent until the first sign of actual agent activity
  // comes back (a real reply, a tool call, an error) — fills what was previously dead air with
  // no feedback at all. Driven by the event stream itself rather than the sendChatMessage IPC
  // call's own promise, since that promise resolves at different points per adapter (Claude's
  // persistent process vs. the one-shot CLIs, whose sendMessage() only resolves once the whole
  // turn's child process exits) — the event stream is the one thing consistently true across all
  // of them. Deliberately not tied to any new broadcast event type or notification logic — pure
  // renderer-local UI state, so it can never itself trigger the unread-activity notification
  // (that only ever fires on a real assistant_message, unaffected by this).
  isThinking: boolean
}

interface ChatStoreState {
  sessions: Record<string, ChatSessionState>
  handleEvent: (sandboxName: string, event: AgentSessionEvent) => void
  addUserMessage: (sandboxName: string, text: string) => void
  ensureSession: (sandboxName: string) => void
  clearSession: (sandboxName: string) => void
}

function emptySession(): ChatSessionState {
  return { messages: [], status: 'idle', mcpServers: [], isThinking: false }
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

  // Resets the visible transcript to empty. Deliberately does NOT touch `status` — the caller
  // (ChatPanel) restarts the underlying session separately so Claude's actual conversation
  // memory is wiped too, not just the display; leaving status alone avoids a spurious flash
  // back to "Not started" before the real restart's status events arrive.
  clearSession: (sandboxName) =>
    set((state) => {
      const session = state.sessions[sandboxName] ?? emptySession()
      return {
        sessions: { ...state.sessions, [sandboxName]: { ...session, messages: [], mcpServers: [] } }
      }
    }),

  addUserMessage: (sandboxName, text) =>
    set((state) => {
      const session = state.sessions[sandboxName] ?? emptySession()
      return {
        sessions: {
          ...state.sessions,
          [sandboxName]: {
            ...session,
            messages: [...session.messages, { kind: 'user', id: nextId(), text }],
            isThinking: true
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
          return {
            sessions: {
              ...state.sessions,
              // "exited" means nothing more is coming for this turn either — clear thinking so
              // the bubble doesn't linger forever if a session ends mid-response.
              [sandboxName]: { ...session, status, isThinking: event.status === 'exited' ? false : session.isThinking }
            }
          }

        case 'assistant_message':
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: {
                ...session,
                messages: [...messages, { kind: 'assistant', id: nextId(), text: event.text }],
                isThinking: false
              }
            }
          }

        case 'tool_use':
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: {
                ...session,
                messages: [
                  ...messages,
                  { kind: 'tool', id: event.id, name: event.name, input: event.input, resultPending: true }
                ],
                isThinking: false
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
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: { ...session, messages: updated, isThinking: false }
            }
          }
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
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: { ...session, messages: updated, isThinking: false }
            }
          }
        }

        case 'error':
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: {
                ...session,
                messages: [...messages, { kind: 'error', id: nextId(), message: event.message }],
                isThinking: false
              }
            }
          }

        case 'mcp_status':
          return {
            sessions: { ...state.sessions, [sandboxName]: { ...session, mcpServers: event.servers } }
          }

        default:
          return state
      }
    })
}))

/**
 * Mounted once at the app root (Layout) so chat responses get recorded into the transcript
 * regardless of which page is open — confirmed live (user report): a response generated while
 * the user had navigated away from that sandbox's Chat tab never appeared when they came back,
 * even though the agent genuinely produced it (Claude itself referenced "my previous reply").
 * Root cause: ChatPanel's own onChatEvent subscription — the only thing that was ever calling
 * handleEvent — only exists while ChatPanel is mounted, i.e. only while that sandbox's detail
 * page happens to be open. Chat events are already broadcast to every window regardless of what
 * page is open (see AgentSessionManager.broadcast), same plumbing the activity-notification
 * listener reuses, so this just needs its own always-on subscription instead of relying on a
 * component that isn't guaranteed to be mounted. ChatPanel no longer subscribes itself — this
 * is now the only place handleEvent gets called, avoiding duplicate messages when it is mounted.
 */
export function useGlobalChatRecorder(): void {
  useEffect(() => {
    const unsubscribe = window.sbxApi.onAnyChatEvent((sandboxName, event) => {
      useChatStore.getState().handleEvent(sandboxName, event)
    })
    return unsubscribe
  }, [])
}
