import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { useChatStore, type ChatMessage, type SessionStatus } from '@renderer/state/chatStore'
import { useDefaultPermissionMode, useSkills } from '@renderer/state/queries'
import { PERMISSION_MODE_OPTIONS } from '@renderer/permissionModes'
import { Markdown } from './Markdown'
import type { ClaudePermissionMode } from '@shared/types'

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'Not started',
  connecting: 'Connecting…',
  ready: 'Ready',
  exited: 'Session ended'
}

const NOT_LOGGED_IN_PATTERN = /not logged in/i

/**
 * Finds an in-progress "/" mention at the cursor, if any — scans backward through non-
 * whitespace looking for a "/" that itself sits at the start of a word (start of the message,
 * or preceded by whitespace), so a path typed inline (e.g. "check src/main/foo.ts") doesn't
 * trigger it — only a "/" that a path segment couldn't itself precede does.
 */
function findActiveMention(text: string, cursor: number): { start: number; query: string } | null {
  let i = cursor - 1
  while (i >= 0 && !/\s/.test(text[i])) {
    if (text[i] === '/') {
      const startOfWord = i === 0 || /\s/.test(text[i - 1])
      return startOfWord ? { start: i, query: text.slice(i + 1, cursor) } : null
    }
    i--
  }
  return null
}

// Every agent with a confirmed headless/structured protocol (see each adapter for the exact
// wire format and gotchas — every one of these was verified live, never assumed). Anything
// else falls through to the "basic mode" message below until it gets its own adapter.
const SUPPORTED_AGENTS = ['claude', 'codex', 'gemini', 'docker-agent']

export function ChatPanel({ sandboxName, agent }: { sandboxName: string; agent: string }): JSX.Element {
  const navigate = useNavigate()
  const ensureSession = useChatStore((s) => s.ensureSession)
  const handleEvent = useChatStore((s) => s.handleEvent)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const clearSession = useChatStore((s) => s.clearSession)
  const endTurn = useChatStore((s) => s.endTurn)
  const session = useChatStore((s) => s.sessions[sandboxName])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [interrupting, setInterrupting] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [mcpChecked, setMcpChecked] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [permissionMode, setPermissionMode] = useState<ClaudePermissionMode>('default')
  const defaultPermissionMode = useDefaultPermissionMode()
  const startedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // "/" mention autocomplete for skills found under this sandbox's own workspace (see
  // src/main/skills.ts) — mentionQuery is the text typed after "/" (empty string right after
  // typing just "/"), null when no mention is in progress. mentionStart is the "/" character's
  // index in `draft`, needed to know what to replace on selection.
  const skills = useSkills(sandboxName)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const mentionMatches =
    mentionQuery === null
      ? []
      : (skills.data ?? []).filter((s) => s.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8)

  const unsupported = !SUPPORTED_AGENTS.includes(agent)
  // /login, the "Sign in to Claude" banner, and the Permissions picker all drive Claude-specific
  // mechanisms (the pty login flow, ClaudePermissionMode) that don't exist for the other agents.
  const isClaude = agent === 'claude'

  // Just ensures a session record exists as soon as this panel mounts — actually recording
  // events into the store happens globally now (see chatStore.useGlobalChatRecorder), not here,
  // so the transcript keeps updating even while the user has navigated away from this sandbox
  // entirely (confirmed live: it previously didn't — a response generated while away from this
  // page never showed up when the user came back, since this per-mount subscription was the
  // only thing calling handleEvent).
  useEffect(() => {
    if (unsupported) return
    ensureSession(sandboxName)
  }, [sandboxName, agent, unsupported, ensureSession])

  // Separately, actually start the session exactly once, waiting for the saved default
  // permission mode to load first so it launches with the user's real preference instead of
  // always starting 'default' and needing a restart. This has no meaningful cleanup (starting
  // twice is already a no-op in the main process), so it's safe for startedRef to survive a
  // StrictMode double-invoke — unlike the subscription above, nothing here needs to be undone.
  useEffect(() => {
    if (unsupported || startedRef.current) return
    if (defaultPermissionMode.data === undefined) return
    startedRef.current = true
    setPermissionMode(defaultPermissionMode.data)
    window.sbxApi.startChatSession(sandboxName, agent, defaultPermissionMode.data).catch((err: Error) => {
      handleEvent(sandboxName, { type: 'error', message: err.message })
    })
  }, [sandboxName, agent, unsupported, defaultPermissionMode.data])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    const last = session?.messages[session.messages.length - 1]
    if (isClaude && last?.kind === 'assistant' && NOT_LOGGED_IN_PATTERN.test(last.text)) {
      setNeedsLogin(true)
    }
  }, [session?.messages.length, session?.turnActive])

  if (unsupported) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
        <Badge tone="warning">basic mode</Badge>
        <p className="text-slate-400">
          There isn't a structured chat adapter for "{agent}" yet — only Claude has one so far.
        </p>
      </div>
    )
  }

  // Replaces the in-progress "/query" (from mentionStart through the cursor) with "/" + the
  // skill name — confirmed live: skills are actually invoked with the literal leading slash
  // (e.g. "/docker-case-followup"), not just the bare name. Distinct from the exact-match
  // "/login"/"/mcp" aliases below, which only ever look at the final trimmed message on send —
  // typing "/mcp" still triggers this picker while typing (showing "no matching skills" unless
  // one happens to be named that), but sending it unselected still hits those aliases exactly
  // as before.
  function selectSkill(name: string): void {
    if (mentionStart === null) return
    const cursor = textareaRef.current?.selectionStart ?? draft.length
    const before = draft.slice(0, mentionStart)
    const after = draft.slice(cursor)
    const inserted = `/${name} `
    setDraft(`${before}${inserted}${after}`)
    setMentionQuery(null)
    setMentionStart(null)
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(pos, pos)
    })
  }

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')

    // "/login" doesn't work over the headless protocol at all (confirmed: it needs a real TTY,
    // same as the interactive /mcp actions) — alias it locally to the pty-based sign-in flow
    // instead of forwarding it to a session that can't do anything with it. Claude-only: the
    // other agents have no equivalent pty login flow built, so "/login" just goes through as a
    // literal message for them (harmless — the model just sees the text).
    if (isClaude && text === '/login') {
      addUserMessage(sandboxName, text)
      handleEvent(sandboxName, {
        type: 'assistant_message',
        text: "Interactive login isn't available over chat — redirecting to the real sign-in flow. Check your browser.",
        messageId: `local-login-${Date.now()}`
      })
      setNeedsLogin(true)
      void handleSignIn()
      return
    }

    // Claude Code's own headless reply to a bare "/mcp" is a one-line connector summary — only
    // surface the "authorize in Terminal" banner once the user has actually asked, rather than
    // on every message whenever some connector happens to need auth.
    if (text === '/mcp') setMcpChecked(true)
    addUserMessage(sandboxName, text)
    setSending(true)
    try {
      await window.sbxApi.sendChatMessage(sandboxName, text)
      // Claude's real turn-completion signal is its own 'turn_end' event; the one-shot
      // Codex/Gemini/docker-agent adapters don't emit an equivalent on success at all, so this
      // IPC call resolving (which for them only happens once their whole-turn child process
      // exits) is the actual completion signal for those three — see chatStore's turnActive
      // comment for the full reasoning.
      if (!isClaude) endTurn(sandboxName)
    } catch (err) {
      handleEvent(sandboxName, { type: 'error', message: (err as Error).message })
    } finally {
      setSending(false)
    }
  }

  // Stops the turn currently in flight — the Chat-tab equivalent of Esc in Claude Code's own
  // TUI (Terminal tab). Unlike Clear chat, this doesn't touch the transcript or ask for
  // confirmation; whatever's already streamed in stays put, and the session is left ready for
  // the next message (Claude's adapter restarts its own child on the next send if this killed
  // it; the one-shot adapters just spawn fresh next time, same as always).
  async function handleInterrupt(): Promise<void> {
    setInterrupting(true)
    try {
      await window.sbxApi.interruptChatTurn(sandboxName)
    } catch (err) {
      handleEvent(sandboxName, { type: 'error', message: (err as Error).message })
    } finally {
      setInterrupting(false)
    }
  }

  async function handleSignIn(): Promise<void> {
    setSigningIn(true)
    try {
      const result = await window.sbxApi.loginClaude(sandboxName)
      if (result.success) {
        setNeedsLogin(false)
      } else {
        handleEvent(sandboxName, { type: 'error', message: result.message })
      }
    } finally {
      setSigningIn(false)
    }
  }

  async function handleClearChat(): Promise<void> {
    if (!confirm('Clear this conversation? This ends the current session — the agent will start fresh, with no memory of anything said so far.')) {
      return
    }
    setClearing(true)
    try {
      // A full reset, not just a visual one: stop the running process (so Claude's actual
      // conversation memory is gone, not just hidden), wipe the transcript, then start a
      // genuinely new session with whatever permission mode is currently selected.
      await window.sbxApi.stopChatSession(sandboxName)
      clearSession(sandboxName)
      setNeedsLogin(false)
      setMcpChecked(false)
      await window.sbxApi.startChatSession(sandboxName, agent, permissionMode).catch((err: Error) => {
        handleEvent(sandboxName, { type: 'error', message: err.message })
      })
    } finally {
      setClearing(false)
    }
  }

  async function handlePermissionModeChange(mode: ClaudePermissionMode): Promise<void> {
    setPermissionMode(mode)
    // The mode is a spawn-time flag — apply it by restarting the session (a no-op stop if
    // nothing is running yet).
    await window.sbxApi.stopChatSession(sandboxName)
    await window.sbxApi.startChatSession(sandboxName, agent, mode).catch((err: Error) => {
      handleEvent(sandboxName, { type: 'error', message: err.message })
    })
  }

  const status = session?.status ?? 'idle'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="text-sm text-slate-400">{STATUS_LABEL[status]}</span>
        <div className="flex items-center gap-3">
          {isClaude && (
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Permissions
              <select
                value={permissionMode}
                onChange={(e) => void handlePermissionModeChange(e.target.value as ClaudePermissionMode)}
                className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-300"
              >
                {PERMISSION_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            disabled={clearing || !session?.messages.length}
            onClick={() => void handleClearChat()}
            className="text-xs text-slate-500 hover:text-slate-300 disabled:cursor-not-allowed disabled:text-slate-700"
          >
            {clearing ? 'Clearing…' : 'Clear chat'}
          </button>
        </div>
      </div>

      {mcpChecked && session && session.mcpServers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 py-2">
          {session.mcpServers.map((s) => (
            <Badge key={s.name} tone={s.status === 'connected' ? 'success' : 'warning'}>
              {s.name} · {s.status}
            </Badge>
          ))}
          <Link
            to={`/sandboxes/${sandboxName}?tab=terminal`}
            className="text-xs text-slate-600 hover:text-slate-400"
            title="Snapshot from when this session started — reload the chat (Clear chat) to refresh it, or check the Terminal tab's /mcp for the live picker."
          >
            (as of session start — verify in Terminal)
          </Link>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-auto py-3">
        <div className="flex flex-col gap-3">
          {session?.messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {session?.turnActive && <ThinkingBubble />}
        </div>
      </div>

      {needsLogin && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-amber-900 bg-amber-950 px-3 py-2">
          <span className="text-sm text-amber-300">This sandbox isn't signed in to Claude yet.</span>
          <Button disabled={signingIn} onClick={() => void handleSignIn()}>
            {signingIn ? 'Waiting for browser sign-in…' : 'Sign in to Claude'}
          </Button>
        </div>
      )}

      {mcpChecked && session?.mcpServers.some((s) => s.status !== 'connected') && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-amber-900 bg-amber-950 px-3 py-2">
          <span className="text-sm text-amber-300">
            One or more MCP connectors need authorization. This isn't fully functional in
            chat — switch to the Terminal tab and run <code>/mcp</code> to authorize them.
          </span>
          <Button variant="secondary" onClick={() => navigate(`/sandboxes/${sandboxName}?tab=terminal`)}>
            Open Terminal
          </Button>
        </div>
      )}

      <div className="relative flex gap-2 border-t border-slate-800 pt-3">
        {mentionQuery !== null && (
          <div className="absolute bottom-full left-0 z-10 mb-1 max-h-48 w-64 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 shadow-lg">
            {mentionMatches.length > 0 ? (
              mentionMatches.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onMouseDown={(e) => {
                    // Prevents the textarea from blurring before selectSkill reads its
                    // (still-current) cursor position from selectionStart.
                    e.preventDefault()
                    selectSkill(name)
                  }}
                  className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                    i === highlightIndex ? 'bg-indigo-950 text-indigo-200' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {name}
                </button>
              ))
            ) : (
              <p className="px-3 py-1.5 text-sm text-slate-500">No matching skills</p>
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            const value = e.target.value
            setDraft(value)
            const mention = findActiveMention(value, e.target.selectionStart)
            setMentionStart(mention?.start ?? null)
            setMentionQuery(mention?.query ?? null)
            setHighlightIndex(0)
          }}
          onKeyDown={(e) => {
            if (mentionQuery !== null && mentionMatches.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlightIndex((i) => (i + 1) % mentionMatches.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlightIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                selectSkill(mentionMatches[highlightIndex])
                return
              }
            }
            if (e.key === 'Escape' && mentionQuery !== null) {
              e.preventDefault()
              setMentionQuery(null)
              setMentionStart(null)
              return
            }
            // Matches Esc's meaning in Claude Code's own TUI (and this app's Terminal tab) —
            // interrupt whatever's running, but only when there's actually a turn in flight and
            // no mention dropdown is claiming the key first.
            if (e.key === 'Escape' && session?.turnActive) {
              e.preventDefault()
              void handleInterrupt()
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          rows={2}
          placeholder={
            skills.data && skills.data.length > 0 ? `Message ${agent}… (/ to mention a skill)` : `Message ${agent}…`
          }
          className="flex-1 resize-none rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
        />
        {session?.turnActive ? (
          <Button variant="secondary" disabled={interrupting} onClick={() => void handleInterrupt()} title="Esc">
            {interrupting ? 'Stopping…' : 'Stop'}
          </Button>
        ) : (
          <Button disabled={sending || !draft.trim()} onClick={() => void handleSend()}>
            Send
          </Button>
        )}
      </div>
    </div>
  )
}

// Shown for the entire span chatStore's turnActive covers — from sending a message until the
// turn is genuinely done, not just until the first bit of output arrives (see the turnActive
// comment for why that distinction matters: a skill printing early progress output used to make
// this disappear while the agent was still visibly working). Never itself seen by the
// notification system, since it's not a broadcast event.
function ThinkingBubble(): JSX.Element {
  return (
    <div className="flex max-w-[85%] animate-fade-in items-center gap-1 rounded-lg bg-slate-800 px-3 py-2.5">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-500" />
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  if (message.kind === 'user') {
    return (
      <div className="ml-auto max-w-[80%] rounded-lg bg-indigo-950 px-3 py-2 text-sm text-indigo-100">
        {message.text}
      </div>
    )
  }
  if (message.kind === 'assistant') {
    return (
      <div className="max-w-[85%] rounded-lg bg-slate-800 px-3 py-2">
        <Markdown text={message.text} />
      </div>
    )
  }
  if (message.kind === 'tool') {
    if (message.blockedReason) {
      return (
        <div className="max-w-[85%] rounded-lg border border-amber-900 bg-amber-950 px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <Badge tone="warning">{message.name} blocked</Badge>
          </div>
          <p className="mt-2 text-amber-300">{message.blockedReason}</p>
          <p className="mt-1 text-amber-400/70">
            Sandbox policy blocked this automatically — there's no in-chat "approve" step for a
            specific command. Switch to the Terminal tab to run it interactively, or raise
            Permissions above to "Auto" (works around it, slower) or "Bypass all checks" for
            this session.
          </p>
        </div>
      )
    }
    return (
      <div className="max-w-[85%] rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <Badge tone={message.isError ? 'danger' : 'neutral'}>{message.name}</Badge>
          {message.resultPending && <span className="text-slate-500">running…</span>}
        </div>
        {message.result && (
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-slate-400">{message.result}</pre>
        )}
      </div>
    )
  }
  return (
    <div className="max-w-[85%] rounded-lg border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
      {message.message}
    </div>
  )
}
