import { Link, useParams } from 'react-router-dom'
import { Badge } from '@renderer/components/ui/Badge'
import { useSandboxes } from '@renderer/state/queries'
import { ChatPanel } from './ChatPanel'

export function SandboxDetail(): JSX.Element {
  const { name } = useParams<{ name: string }>()
  const sandboxes = useSandboxes()
  const sandbox = sandboxes.data?.find((sb) => sb.name === name)

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
      <div className="min-h-0 flex-1 rounded-lg border border-slate-800 bg-slate-900 p-4">
        <ChatPanel sandboxName={sandbox.name} agent={sandbox.agent} />
      </div>
    </div>
  )
}
