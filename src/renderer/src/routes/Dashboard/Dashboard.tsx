import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@renderer/components/ui/Badge'
import { Card } from '@renderer/components/ui/Card'
import { Button } from '@renderer/components/ui/Button'
import { useHealth, useSandboxes } from '@renderer/state/queries'
import { useRemoveSandboxes, useStartSandbox, useStopSandboxes } from '@renderer/state/mutations'
import { CreateSandboxWizard } from './CreateSandboxWizard'
import type { SandboxStatus } from '@shared/types'

const STATUS_TONE: Record<SandboxStatus, 'success' | 'neutral' | 'warning'> = {
  running: 'success',
  stopped: 'neutral',
  unknown: 'warning'
}

export function Dashboard(): JSX.Element {
  const navigate = useNavigate()
  const health = useHealth()
  const sandboxes = useSandboxes()
  const startSandbox = useStartSandbox()
  const stopSandboxes = useStopSandboxes()
  const removeSandboxes = useRemoveSandboxes()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  async function handleStart(name: string): Promise<void> {
    setPendingAction(name)
    try {
      await startSandbox.mutateAsync(name)
    } finally {
      setPendingAction(null)
    }
  }

  async function handleStop(name: string): Promise<void> {
    setPendingAction(name)
    try {
      await stopSandboxes.mutateAsync([name])
    } finally {
      setPendingAction(null)
    }
  }

  async function handleRemove(name: string): Promise<void> {
    if (!confirm(`Remove sandbox "${name}"? This cannot be undone.`)) return
    setPendingAction(name)
    try {
      await removeSandboxes.mutateAsync([name])
    } finally {
      setPendingAction(null)
    }
  }

  if (health.isLoading) {
    return <p className="text-slate-400">Checking Docker Sandboxes status…</p>
  }

  if (health.data && !health.data.binaryFound) {
    return (
      <Card>
        <p className="font-medium text-red-400">sbx not found on PATH</p>
        <p className="mt-1 text-sm text-slate-400">
          Install Docker Sandboxes to get started. (Onboarding flow lands in a later milestone.)
        </p>
      </Card>
    )
  }

  if (health.data && !health.data.daemonUp) {
    return (
      <Card>
        <p className="font-medium text-amber-400">sandboxd daemon is not running</p>
        <p className="mt-1 text-sm text-slate-400">Run `sbx daemon start` and refresh.</p>
      </Card>
    )
  }

  if (health.data && !health.data.loggedIn) {
    return (
      <Card>
        <p className="font-medium text-amber-400">Not logged in to Docker</p>
        <p className="mt-1 text-sm text-slate-400">
          Run `sbx login` and refresh. (Onboarding flow lands in a later milestone.)
        </p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sandboxes</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">sbx {health.data?.version ?? '?'}</span>
          <Button onClick={() => setWizardOpen(true)}>New sandbox</Button>
        </div>
      </div>

      {sandboxes.isLoading && <p className="text-slate-400">Loading sandboxes…</p>}
      {sandboxes.isError && (
        <Card>
          <p className="text-red-400">{(sandboxes.error as Error).message}</p>
        </Card>
      )}

      {sandboxes.data && sandboxes.data.length === 0 && (
        <Card>
          <p className="text-slate-400">No sandboxes yet. Click "New sandbox" to create one.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sandboxes.data?.map((sb) => (
          <Card
            key={sb.name}
            onClick={() => navigate(`/sandboxes/${sb.name}`)}
            className="flex cursor-pointer flex-col gap-2 transition-colors hover:border-slate-600"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{sb.name}</span>
              <Badge tone={STATUS_TONE[sb.status]}>{sb.status}</Badge>
            </div>
            <div className="text-xs text-slate-400">agent: {sb.agent}</div>
            <div className="truncate text-xs text-slate-500" title={sb.workspace}>
              {sb.workspace}
            </div>
            {sb.ports.length > 0 && (
              <div className="text-xs text-slate-400">
                ports: {sb.ports.map((p) => `${p.hostPort}->${p.sandboxPort}/${p.protocol}`).join(', ')}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              {sb.status === 'running' ? (
                <Button
                  variant="secondary"
                  disabled={pendingAction === sb.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleStop(sb.name)
                  }}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={pendingAction === sb.name}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleStart(sb.name)
                  }}
                >
                  {pendingAction === sb.name ? 'Starting…' : 'Run'}
                </Button>
              )}
              <Button
                variant="danger"
                disabled={pendingAction === sb.name}
                onClick={(e) => {
                  e.stopPropagation()
                  void handleRemove(sb.name)
                }}
              >
                Remove
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {wizardOpen && <CreateSandboxWizard onClose={() => setWizardOpen(false)} />}
    </div>
  )
}
