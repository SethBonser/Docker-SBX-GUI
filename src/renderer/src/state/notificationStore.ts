import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { stripAnsi } from '@shared/ansi'
import { useSandboxes } from './queries'

// Below this many stripped-of-ANSI visible characters, a terminal chunk is treated as cosmetic
// redraw noise rather than real activity — confirmed live (user report): raw "any new output"
// was firing on cursor blinks, with nothing actually new on screen when the user went to look.
// Tuned by feel, not measured against real byte patterns (no way to capture those without a live
// session) — if this is still noisy, or starts missing genuinely short real messages, this is
// the first thing to revisit.
const MIN_MEANINGFUL_TERMINAL_CHARS = 20

/**
 * A length floor alone doesn't catch a *repeating* status line like a "Thinking… (12s · esc to
 * interrupt)"-style elapsed-time indicator — confirmed live (user report, reproduced with a
 * synthetic sequence): it's comfortably longer than MIN_MEANINGFUL_TERMINAL_CHARS, so it kept
 * firing once a second as the number ticked up, and the user found nothing new when they went to
 * check. Normalizing digits away before comparing against the last chunk seen for that sandbox
 * treats "Thinking… (1s...)" and "Thinking… (2s...)" as the same content, so only the *first*
 * tick of a run counts as activity — deliberately not zero, since "the agent started working" is
 * arguably still worth knowing about, just not once a second for as long as it keeps going.
 */
function normalizeForDedup(text: string): string {
  return text.replace(/\d+/g, '#')
}

// Tracks which sandbox+tab the user is currently looking at, so the global activity listener
// (see useGlobalActivityListener) knows whether to flag new Chat/Terminal activity as unread.
// Kept as a plain module-level store rather than something SandboxDetail computes locally,
// since the listener that needs to read it is mounted once at the app root (Layout), entirely
// separate from whichever sandbox page happens to be open.
interface ActiveView {
  sandboxName: string | null
  tab: string | null
}

interface NotificationState extends ActiveView {
  chatUnread: Record<string, boolean>
  terminalUnread: Record<string, boolean>
  setActiveView: (sandboxName: string | null, tab: string | null) => void
  markChatUnread: (sandboxName: string) => void
  markTerminalUnread: (sandboxName: string) => void
  clearChatUnread: (sandboxName: string) => void
  clearTerminalUnread: (sandboxName: string) => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  sandboxName: null,
  tab: null,
  chatUnread: {},
  terminalUnread: {},

  setActiveView: (sandboxName, tab) => set({ sandboxName, tab }),

  markChatUnread: (sandboxName) =>
    set((state) => ({ chatUnread: { ...state.chatUnread, [sandboxName]: true } })),
  markTerminalUnread: (sandboxName) =>
    set((state) => ({ terminalUnread: { ...state.terminalUnread, [sandboxName]: true } })),
  clearChatUnread: (sandboxName) =>
    set((state) => ({ chatUnread: { ...state.chatUnread, [sandboxName]: false } })),
  clearTerminalUnread: (sandboxName) =>
    set((state) => ({ terminalUnread: { ...state.terminalUnread, [sandboxName]: false } }))
}))

/** True if the given sandbox has unseen Chat or Terminal activity. */
export function hasUnread(state: NotificationState, sandboxName: string): boolean {
  return Boolean(state.chatUnread[sandboxName] || state.terminalUnread[sandboxName])
}

/**
 * Mounted once at the app root (Layout) so it's always listening regardless of which page is
 * open. Marks a sandbox's Chat/Terminal activity unread unless the user is currently looking at
 * that exact sandbox+tab combination — matches SandboxDetail's own setActiveView calls.
 *
 * Terminal has no clean concept of "one message" (it's a raw pty byte stream), so a new-output
 * chunk while not on that sandbox's Terminal tab counts as activity *if* it looks like it has
 * real content once ANSI escape codes are stripped (see MIN_MEANINGFUL_TERMINAL_CHARS above) —
 * a plain "any new output" heuristic (what tmux/iTerm use for their own activity indicators)
 * was tried first and confirmed live to be too noisy for an agent TUI specifically, firing on
 * cursor blinks and periodic spinner/elapsed-time redraws with nothing actually new to see.
 *
 * Confirmed live (user report): stopping a sandbox can itself produce trailing chat/terminal
 * output (a final pty write as the session tears down, a session-ended event) — worth silencing
 * rather than alerting on, since there's no running agent left to have "said" anything. Guarded
 * two ways: new events for a non-running sandbox never mark unread in the first place, and any
 * unread flag already set gets cleared the moment that sandbox's status stops being "running"
 * (covers the case where the flag got set moments before the stop actually completed).
 */
export function useGlobalActivityListener(): void {
  const sandboxes = useSandboxes()
  const sandboxesRef = useRef(sandboxes.data)
  const lastTerminalChunkRef = useRef<Record<string, string>>({})
  useEffect(() => {
    sandboxesRef.current = sandboxes.data
  }, [sandboxes.data])

  useEffect(() => {
    if (!sandboxes.data) return
    const state = useNotificationStore.getState()
    for (const sb of sandboxes.data) {
      if (sb.status === 'running') continue
      if (state.chatUnread[sb.name]) state.clearChatUnread(sb.name)
      if (state.terminalUnread[sb.name]) state.clearTerminalUnread(sb.name)
    }
  }, [sandboxes.data])

  useEffect(() => {
    const unsubChat = window.sbxApi.onAnyChatEvent((sandboxName, event) => {
      if (event.type !== 'assistant_message') return
      const active = useNotificationStore.getState()
      if (active.sandboxName === sandboxName && active.tab === 'chat') return
      const sb = sandboxesRef.current?.find((s) => s.name === sandboxName)
      if (sb && sb.status !== 'running') return
      useNotificationStore.getState().markChatUnread(sandboxName)
    })
    const unsubTerminal = window.sbxApi.onAnyTerminalData((sandboxName, data) => {
      const active = useNotificationStore.getState()
      if (active.sandboxName === sandboxName && active.tab === 'terminal') return
      const sb = sandboxesRef.current?.find((s) => s.name === sandboxName)
      if (sb && sb.status !== 'running') return

      const stripped = stripAnsi(data).trim()
      if (stripped.length < MIN_MEANINGFUL_TERMINAL_CHARS) return

      const normalized = normalizeForDedup(stripped)
      if (lastTerminalChunkRef.current[sandboxName] === normalized) return
      lastTerminalChunkRef.current[sandboxName] = normalized

      useNotificationStore.getState().markTerminalUnread(sandboxName)
    })
    return () => {
      unsubChat()
      unsubTerminal()
    }
  }, [])
}
