import { useEffect, useRef, useState } from 'react'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { useChatStore, type ChatMessage, type SessionStatus } from '@renderer/state/chatStore'
import { Markdown } from './Markdown'

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'Not started',
  connecting: 'Connecting…',
  ready: 'Ready',
  exited: 'Session ended'
}

const NOT_LOGGED_IN_PATTERN = /not logged in/i

export function ChatPanel({ sandboxName, agent }: { sandboxName: string; agent: string }): JSX.Element {
  const ensureSession = useChatStore((s) => s.ensureSession)
  const handleEvent = useChatStore((s) => s.handleEvent)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const session = useChatStore((s) => s.sessions[sandboxName])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const unsupported = agent !== 'claude'

  useEffect(() => {
    if (unsupported) return
    ensureSession(sandboxName)
    const unsubscribe = window.sbxApi.onChatEvent(sandboxName, (event) => handleEvent(sandboxName, event))
    window.sbxApi.startChatSession(sandboxName, agent).catch((err: Error) => {
      handleEvent(sandboxName, { type: 'error', message: err.message })
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxName, agent])

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

  const status = session?.status ?? 'idle'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <span className="text-sm text-slate-400">{STATUS_LABEL[status]}</span>
      </div>

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
