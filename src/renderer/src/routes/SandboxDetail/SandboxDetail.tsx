import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@renderer/components/ui/Badge'
import { useDefaultView, useSandboxes } from '@renderer/state/queries'
import { ChatPanel } from './ChatPanel'
import { TerminalView } from './TerminalView'
import type { DefaultView } from '@shared/types'

export function SandboxDetail(): JSX.Element {
  const { name } = useParams<{ name: string }>()
  const sandboxes = useSandboxes()
  const sandbox = sandboxes.data?.find((sb) => sb.name === name)
  const defaultView = useDefaultView()
  const [tab, setTab] = useState<DefaultView>('chat')
  const appliedDefault = useRef(false)

  // Apply the user's saved default view once it loads, but only before they've made their
  // own choice for this session — don't fight a manual tab switch.
  useEffect(() => {
    if (!appliedDefault.current && defaultView.data) {
      setTab(defaultView.data)
      appliedDefault.current = true
    }
  }, [defaultView.data])

  if (sandboxes.isLoading) {
    return <p className="text-slate-400">Loading…</p>
  }

  if (!sandbox) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-slate-400">Sandbox "{name}" not found.</p>
        <Link to="/" className="text-sm text-indigo-400 underline">
          Back to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-300">
          ← Dashboard
        </Link>
        <h1 className="text-lg font-semibold">{sandbox.name}</h1>
        <Badge tone="neutral">{sandbox.agent}</Badge>
        <Badge tone={sandbox.status === 'running' ? 'success' : 'neutral'}>{sandbox.status}</Badge>
      </div>

      <div className="flex gap-1 border-b border-slate-800">
        {(['chat', 'terminal'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              appliedDefault.current = true // a manual pick beats the saved default from here on
              setTab(t)
            }}
            className={`px-3 py-1.5 text-sm capitalize ${
              tab === t
                ? 'border-b-2 border-indigo-500 text-white'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/*
        Both views stay mounted the whole time this page is open — switching tabs is a
        CSS visibility toggle, not a mount/unmount, so neither the chat conversation nor
        the terminal's live xterm instance and scroll position are lost when you switch
        back and forth.
      */}
      <div className="min-h-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className={tab === 'chat' ? 'h-full' : 'hidden'}>
          <ChatPanel sandboxName={sandbox.name} agent={sandbox.agent} />
        </div>
        <div className={tab === 'terminal' ? 'h-full' : 'hidden'}>
          <TerminalView sandboxName={sandbox.name} active={tab === 'terminal'} />
        </div>
      </div>
    </div>
  )
}
