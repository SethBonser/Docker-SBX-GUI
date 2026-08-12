import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { useChatStore, type ChatMessage, type SessionStatus } from '@renderer/state/chatStore'
import { useDefaultPermissionMode } from '@renderer/state/queries'
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

export function ChatPanel({ sandboxName, agent }: { sandboxName: string; agent: string }): JSX.Element {
  const navigate = useNavigate()
  const ensureSession = useChatStore((s) => s.ensureSession)
  const handleEvent = useChatStore((s) => s.handleEvent)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const clearSession = useChatStore((s) => s.clearSession)
  const session = useChatStore((s) => s.sessions[sandboxName])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [mcpChecked, setMcpChecked] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [permissionMode, setPermissionMode] = useState<ClaudePermissionMode>('default')
  const defaultPermissionMode = useDefaultPermissionMode()
  const startedRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const unsupported = agent !== 'claude'

  // Subscription must always symmetrically subscribe/unsubscribe on every effect run — React
  // (StrictMode in dev especially) can legitimately run setup -> cleanup -> setup again on the
  // same mount, and gating this behind a "only once" ref would tear down the listener on the
  // cleanup pass and then skip resubscribing, leaving the renderer permanently deaf to a chat
  // session that's actually alive and running in the main process.
  useEffect(() => {
    if (unsupported) return
    ensureSession(sandboxName)
    const unsubscribe = window.sbxApi.onChatEvent(sandboxName, (event) => handleEvent(sandboxName, event))
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxName, agent, unsupported])

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
    if (last?.kind === 'assistant' && NOT_LOGGED_IN_PATTERN.test(last.text)) {
      setNeedsLogin(true)
    }
  }, [session?.messages.length])

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

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')

    // "/login" doesn't work over the headless protocol at all (confirmed: it needs a real TTY,
    // same as the interactive /mcp actions) — alias it locally to the pty-based sign-in flow
    // instead of forwarding it to a session that can't do anything with it.
    if (text === '/login') {
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
    } catch (err) {
      handleEvent(sandboxName, { type: 'error', message: (err as Error).message })
    } finally {
      setSending(false)
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
    if (!confirm('Clear this conversation? This ends the current session — Claude will start fresh, with no memory of anything said so far.')) {
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

      <div className="flex gap-2 border-t border-slate-800 pt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          rows={2}
          placeholder="Message Claude…"
          className="flex-1 resize-none rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-100"
        />
        <Button disabled={sending || !draft.trim()} onClick={() => void handleSend()}>
          Send
        </Button>
      </div>
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
      <div className="max-w-[85%] rounded-lg bg-slate-900 px-3 py-2">
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
