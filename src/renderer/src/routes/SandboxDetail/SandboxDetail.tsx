import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Badge } from '@renderer/components/ui/Badge'
import { useDefaultView, useSandboxes } from '@renderer/state/queries'
import { ChatPanel } from './ChatPanel'
import { TerminalView } from './TerminalView'
import { PortsTab } from './PortsTab'
import { PolicyTab } from './PolicyTab'
import type { DefaultView } from '@shared/types'

type Tab = DefaultView | 'ports' | 'policy'

const TABS: Tab[] = ['chat', 'terminal', 'ports', 'policy']

export function SandboxDetail(): JSX.Element {
  const { name } = useParams<{ name: string }>()
  const sandboxes = useSandboxes()
  const sandbox = sandboxes.data?.find((sb) => sb.name === name)
  const defaultView = useDefaultView()
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    requestedTab && (TABS as string[]).includes(requestedTab) ? (requestedTab as Tab) : 'chat'
  )
  // An explicit ?tab= link (e.g. "verify MCP" from the MCP page) always wins — only fall back
  // to the saved default view when nobody asked for a specific tab.
  const appliedDefault = useRef(requestedTab !== null)

  useEffect(() => {
    if (!appliedDefault.current && defaultView.data) {
      setTab(defaultView.data)
      appliedDefault.current = true
    }
  }, [defaultView.data])

  // Reacts to ?tab= changes even when this page is already mounted (e.g. the "Open Terminal"
  // button in ChatPanel navigates to the same route with a different query string, which
  // doesn't remount the component — only the initial useState() would have missed this).
  useEffect(() => {
    if (requestedTab && (TABS as string[]).includes(requestedTab)) {
      setTab(requestedTab as Tab)
      appliedDefault.current = true
    }
  }, [requestedTab])

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
        {TABS.map((t) => (
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
        Chat and Terminal stay mounted the whole time this page is open — switching tabs is a
        CSS visibility toggle, not a mount/unmount, so neither the chat conversation nor the
        terminal's live xterm instance and scroll position are lost when you switch back and
        forth. Ports/Policy don't hold any live session state (just React Query-backed views),
        so they're mounted normally — the query cache already keeps their data warm across tab
        switches without needing the same always-mounted treatment.
      */}
      <div className="min-h-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <div className={tab === 'chat' ? 'h-full' : 'hidden'}>
          <ChatPanel sandboxName={sandbox.name} agent={sandbox.agent} />
        </div>
        <div className={tab === 'terminal' ? 'h-full' : 'hidden'}>
          <TerminalView sandboxName={sandbox.name} active={tab === 'terminal'} />
        </div>
        {tab === 'ports' && <PortsTab sandboxName={sandbox.name} />}
        {tab === 'policy' && <PolicyTab sandboxName={sandbox.name} />}
      </div>
    </div>
  )
}
