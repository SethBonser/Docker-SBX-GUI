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
  // True from the moment a user message is sent until the turn is genuinely done — drives both
  // the Stop/interrupt control's visibility and the "thinking" bubble shown in the transcript.
  // Confirmed live (user report): an earlier version of this bubble was tied to a flag that
  // cleared the moment *anything* came back (a tool call starting, say), which reads as "done"
  // the instant a skill prints its first bit of bash output even though more is clearly still
  // coming — misleading, not just imprecise. turnActive instead stays true through tool calls
  // and intermediate text, clearing only on genuine completion: Claude's adapter fires a real
  // 'turn_end' event (sourced from the headless protocol's own "result" event); the one-shot
  // Codex/Gemini/docker-agent adapters don't emit an equivalent completion event on success at
  // all (see each adapter's own comment), so ChatPanel's `endTurn` closes it out locally once
  // their `sendChatMessage` call resolves — the one signal that IS consistently true for those
  // three. Also cleared defensively on 'exited'/'error', so it can't get stuck true if a turn
  // ends some other way.
  turnActive: boolean
}

interface ChatStoreState {
  sessions: Record<string, ChatSessionState>
  handleEvent: (sandboxName: string, event: AgentSessionEvent) => void
  addUserMessage: (sandboxName: string, text: string) => void
  ensureSession: (sandboxName: string) => void
  clearSession: (sandboxName: string) => void
  endTurn: (sandboxName: string) => void
  // Unlike clearSession (which resets a session's transcript in place, for a sandbox that still
  // exists), this removes the session entirely — for when the sandbox itself is gone. Confirmed
  // live: removing a sandbox and creating a new one under the same name showed the *old*
  // sandbox's chat transcript, since sessions are keyed only by name and nothing ever deleted
  // the old entry — `ensureSession` saw the name already had an entry and left it alone.
  removeSession: (sandboxName: string) => void
}

function emptySession(): ChatSessionState {
  return { messages: [], status: 'idle', mcpServers: [], turnActive: false }
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

  removeSession: (sandboxName) =>
    set((state) => {
      if (!(sandboxName in state.sessions)) return state
      const sessions = { ...state.sessions }
      delete sessions[sandboxName]
      return { sessions }
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
            turnActive: true
          }
        }
      }
    }),

  // Renderer-local turn-completion signal for the one-shot adapters (Codex/Gemini/docker-agent),
  // which don't emit any event of their own for a successful turn end — see the turnActive
  // comment above. Only ChatPanel calls this, and only for non-Claude agents; Claude's real
  // completion always comes from the 'turn_end' event below instead.
  endTurn: (sandboxName) =>
    set((state) => {
      const session = state.sessions[sandboxName]
      if (!session) return state
      return { sessions: { ...state.sessions, [sandboxName]: { ...session, turnActive: false } } }
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
              // "exited" means nothing more is coming for this turn either — clear turnActive so
              // an interrupted/crashed session doesn't leave Stop or the thinking bubble stuck
              // visible if a session ends mid-response.
              [sandboxName]: {
                ...session,
                status,
                turnActive: event.status === 'exited' ? false : session.turnActive
              }
            }
          }

        case 'assistant_message':
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: {
                ...session,
                messages: [...messages, { kind: 'assistant', id: nextId(), text: event.text }]
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
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: { ...session, messages: updated }
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
              [sandboxName]: { ...session, messages: updated }
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
                turnActive: false
              }
            }
          }

        case 'turn_end':
          return {
            sessions: {
              ...state.sessions,
              [sandboxName]: { ...session, turnActive: false }
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
