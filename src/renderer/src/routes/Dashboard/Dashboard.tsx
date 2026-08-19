import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@renderer/components/ui/Badge'
import { Card } from '@renderer/components/ui/Card'
import { Button } from '@renderer/components/ui/Button'
import { useHealth, useSandboxes } from '@renderer/state/queries'
import { hasUnread, useNotificationStore } from '@renderer/state/notificationStore'
import {
  useDaemonStart,
  useRemoveSandboxes,
  useStartSandbox,
  useStopSandboxes
} from '@renderer/state/mutations'
import { CreateSandboxWizard } from './CreateSandboxWizard'
import type { SandboxStatus } from '@shared/types'

const STATUS_TONE: Record<SandboxStatus, 'success' | 'neutral' | 'warning'> = {
  running: 'success',
  stopped: 'neutral',
  unknown: 'warning'
}

const INSTALL_COMMAND = 'winget install -h Docker.sbx'

/**
 * First-run "sbx isn't installed" state. Deliberately shows the install command for the user to
 * copy and run themselves (in their own terminal) rather than this app spawning `winget` on
 * their behalf — installing software is the kind of system-modifying action that stays a manual,
 * user-initiated step even though the command itself is safe and well-known.
 */
function InstallSbxCard(): JSX.Element {
  const queryClient = useQueryClient()
  const [copied, setCopied] = useState(false)
  const [rechecking, setRechecking] = useState(false)

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(INSTALL_COMMAND)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleRecheck(): Promise<void> {
    setRechecking(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ['health'] })
    } finally {
      setRechecking(false)
    }
  }

  return (
    <Card className="flex max-w-xl flex-col gap-3">
      <div>
        <p className="font-medium text-slate-100">Let's get Docker Sandboxes installed</p>
        <p className="mt-1 text-sm text-slate-400">
          This app manages Docker Sandboxes (the <code>sbx</code> CLI) but doesn't install it —
          run this command in a terminal (PowerShell or Command Prompt), then come back here.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200">
          {INSTALL_COMMAND}
        </code>
        <Button variant="secondary" onClick={() => void handleCopy()}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <p className="text-xs text-slate-500">Requires Windows 11 (x64) with Hypervisor Platform enabled.</p>
      <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
        <Button disabled={rechecking} onClick={() => void handleRecheck()}>
          {rechecking ? 'Checking…' : "I've installed it — Recheck"}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void window.sbxApi.openExternal('https://docs.docker.com/ai/sandboxes/get-started/')}
        >
          Installation docs
        </Button>
      </div>
    </Card>
  )
}

/** Not-logged-in state — reuses the exact login flow UserBadge's dropdown uses. */
function SignInCard(): JSX.Element {
  const queryClient = useQueryClient()
  const [signingIn, setSigningIn] = useState(false)

  async function handleSignIn(): Promise<void> {
    setSigningIn(true)
    try {
      await window.sbxApi.login()
      await queryClient.invalidateQueries({ queryKey: ['health'] })
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <Card className="max-w-xl">
      <p className="font-medium text-amber-400">Not signed in to Docker</p>
      <p className="mt-1 text-sm text-slate-400">
        Sign in to create and manage sandboxes — this opens your browser for the real{' '}
        <code>sbx login</code> OAuth flow.
      </p>
      <Button className="mt-3" disabled={signingIn} onClick={() => void handleSignIn()}>
        {signingIn ? 'Waiting for browser…' : 'Sign in to Docker'}
      </Button>
    </Card>
  )
}

/** Daemon-down state — reuses the same daemonStart mutation as the Settings page. */
function DaemonDownCard(): JSX.Element {
  const daemonStart = useDaemonStart()

  return (
    <Card className="max-w-xl">
      <p className="font-medium text-amber-400">sandboxd daemon is not running</p>
      <p className="mt-1 text-sm text-slate-400">The daemon manages every sandbox's VM and networking.</p>
      <Button className="mt-3" disabled={daemonStart.isPending} onClick={() => daemonStart.mutate()}>
        {daemonStart.isPending ? 'Starting…' : 'Start daemon'}
      </Button>
      {daemonStart.isError && (
        <p className="mt-2 text-xs text-red-400">{(daemonStart.error as Error).message}</p>
      )}
    </Card>
  )
}

/**
 * Nudges a genuinely first-time user (no sandboxes created yet) toward the global Policy page's
 * tier switcher before their first `sbx create` implicitly auto-initializes one for them. Not a
 * hard gate — sbx picks a sensible default on its own — just a pointer to where that choice
 * actually lives. Self-clearing: disappears the moment any sandbox exists, no dismiss state needed.
 */
function FirstRunPolicyNudge(): JSX.Element {
  const navigate = useNavigate()
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-indigo-900 bg-indigo-950/30 p-4">
      <div>
        <p className="text-sm font-medium text-slate-100">New here? Set your network policy first.</p>
        <p className="mt-1 text-xs text-slate-400">
          Sandboxes get a default network policy tier the first time you create one — worth
          picking it deliberately instead of leaving it to the default.
        </p>
      </div>
      <Button variant="secondary" onClick={() => navigate('/policy')}>
        Go to Policy
      </Button>
    </div>
  )
}

export function Dashboard(): JSX.Element {
  const navigate = useNavigate()
  const health = useHealth()
  const sandboxes = useSandboxes()
  const notifications = useNotificationStore()
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
    return <InstallSbxCard />
  }

  if (health.data && !health.data.daemonUp) {
    return <DaemonDownCard />
  }

  if (health.data && !health.data.loggedIn) {
    return <SignInCard />
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
        <>
          <FirstRunPolicyNudge />
          <Card>
            <p className="text-slate-400">No sandboxes yet. Click "New sandbox" to create one.</p>
          </Card>
        </>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sandboxes.data?.map((sb) => {
          const unread = hasUnread(notifications, sb.name)
          return (
            <Card
              key={sb.name}
              onClick={() => navigate(`/sandboxes/${sb.name}`)}
              className={`relative flex animate-fade-in cursor-pointer flex-col gap-2 hover:border-slate-600 ${
                unread ? 'border-amber-500/70' : ''
              }`}
            >
              {unread && (
                <span
                  title="Unseen Chat/Terminal activity"
                  className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full bg-amber-400"
                />
              )}
              <div className="flex items-center justify-between">
                <span className="font-medium">{sb.name}</span>
                <div className="flex items-center gap-1.5">
                  {sb.gpu && (
                    <Badge tone="warning" title="Created with NVIDIA GPU passthrough">
                      GPU
                    </Badge>
                  )}
                  <Badge tone={STATUS_TONE[sb.status]}>{sb.status}</Badge>
                </div>
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
          )
        })}
      </div>

      {wizardOpen && <CreateSandboxWizard onClose={() => setWizardOpen(false)} />}
    </div>
  )
}
