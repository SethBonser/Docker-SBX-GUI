import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { useDefaultPermissionMode, useDefaultView, useHealth } from '@renderer/state/queries'
import {
  useDaemonRestart,
  useDaemonStart,
  useDaemonStop,
  useDiagnose,
  useSetDefaultPermissionMode,
  useSetDefaultView
} from '@renderer/state/mutations'
import { PERMISSION_MODE_OPTIONS } from '@renderer/permissionModes'
import type { ClaudePermissionMode, DefaultView } from '@shared/types'

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pass: 'success',
  warn: 'warning',
  fail: 'danger',
  skip: 'neutral'
}

export function Settings(): JSX.Element {
  const health = useHealth()
  const defaultView = useDefaultView()
  const setDefaultView = useSetDefaultView()
  const defaultPermissionMode = useDefaultPermissionMode()
  const setDefaultPermissionMode = useSetDefaultPermissionMode()
  const daemonStart = useDaemonStart()
  const daemonStop = useDaemonStop()
  const daemonRestart = useDaemonRestart()
  const diagnose = useDiagnose()

  const username = health.data?.username ?? null

  async function handleStop(): Promise<void> {
    if (
      !confirm(
        'Stop the sandboxd daemon? Every running sandbox becomes unreachable until it is started again.'
      )
    ) {
      return
    }
    await daemonStop.mutateAsync()
  }

  async function handleRestart(): Promise<void> {
    if (
      !confirm(
        'Restart the sandboxd daemon? Every running sandbox becomes briefly unreachable while it restarts.'
      )
    ) {
      return
    }
    await daemonRestart.mutateAsync()
  }

  const daemonError = daemonStart.error ?? daemonStop.error ?? daemonRestart.error

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
        <p className="mt-1 text-sm text-slate-400">
          Docker Sandboxes account, defaults, installation status, and diagnostics.
        </p>
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-300">Account</h2>
        <p className="text-sm text-slate-400">
          {username ? (
            <>
              Signed in as <span className="text-slate-200">{username}</span>
            </>
          ) : (
            'Not signed in to Docker'
          )}
          <span className="text-slate-600"> — sign in/out from the account badge, top right.</span>
        </p>

        <div className="border-t border-slate-800 pt-3">
          <p className="text-xs text-slate-500">Default sandbox view</p>
          <div className="mt-1.5 flex gap-1">
            {(['chat', 'terminal'] as const).map((view) => (
              <button
                key={view}
                onClick={() => setDefaultView.mutate(view as DefaultView)}
                className={`rounded-md px-3 py-1 text-xs capitalize ${
                  defaultView.data === view
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-slate-500">Default chat permissions</p>
          <select
            value={defaultPermissionMode.data ?? 'default'}
            onChange={(e) => setDefaultPermissionMode.mutate(e.target.value as ClaudePermissionMode)}
            className="mt-1.5 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-300"
          >
            {PERMISSION_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-slate-300">Daemon</h2>
        {health.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
        {health.data && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={health.data.binaryFound ? 'success' : 'danger'}>
              {health.data.binaryFound ? `sbx v${health.data.version ?? '?'}` : 'sbx binary not found'}
            </Badge>
            <Badge tone={health.data.daemonUp ? 'success' : 'danger'}>
              daemon {health.data.daemonUp ? 'running' : 'stopped'}
            </Badge>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
          <Button
            variant="secondary"
            disabled={daemonStart.isPending || health.data?.daemonUp}
            onClick={() => daemonStart.mutate()}
          >
            {daemonStart.isPending ? 'Starting…' : 'Start daemon'}
          </Button>
          <Button
            variant="secondary"
            disabled={daemonRestart.isPending || !health.data?.daemonUp}
            onClick={() => void handleRestart()}
          >
            {daemonRestart.isPending ? 'Restarting…' : 'Restart daemon'}
          </Button>
          <Button
            variant="danger"
            disabled={daemonStop.isPending || !health.data?.daemonUp}
            onClick={() => void handleStop()}
          >
            {daemonStop.isPending ? 'Stopping…' : 'Stop daemon'}
          </Button>
        </div>
        {daemonError && <p className="text-sm text-red-400">{(daemonError as Error).message}</p>}
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-300">Diagnostics</h2>
          <Button variant="secondary" disabled={diagnose.isPending} onClick={() => diagnose.mutate()}>
            {diagnose.isPending ? 'Running…' : 'Run sbx diagnose'}
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Checks the CLI binary, daemon health, storage directories, and authentication —
          exactly what <code>sbx diagnose</code> reports on the command line.
        </p>
        {diagnose.isError && <p className="text-sm text-red-400">{(diagnose.error as Error).message}</p>}
        {diagnose.data && (
          <>
            <p className="text-xs text-slate-500">
              {diagnose.data.summary.pass} passed · {diagnose.data.summary.warn} warned ·{' '}
              {diagnose.data.summary.fail} failed · {diagnose.data.summary.skip} skipped
            </p>
            <div className="flex flex-col gap-1.5">
              {diagnose.data.checks.map((check) => (
                <div
                  key={check.name}
                  className="flex animate-fade-in flex-col gap-0.5 rounded-md border border-slate-800 px-2 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[check.status] ?? 'neutral'}>{check.status}</Badge>
                    <span className="text-slate-200">{check.name}</span>
                    <span className="text-slate-500">{check.message}</span>
                  </div>
                  {check.detail && <span className="pl-1 text-slate-500">{check.detail}</span>}
                  {check.hint && <span className="pl-1 text-amber-400">{check.hint}</span>}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-300">About</h2>
        <p className="text-xs text-slate-500">
          {health.data?.version ? `sbx v${health.data.version}` : 'Version unknown'}
        </p>
        <div className="flex gap-3">
          <button
            className="text-xs text-indigo-400 hover:text-indigo-300"
            onClick={() => void window.sbxApi.openExternal('https://docs.docker.com/ai/sandboxes/')}
          >
            Sandboxes documentation
          </button>
          <button
            className="text-xs text-indigo-400 hover:text-indigo-300"
            onClick={() => void window.sbxApi.openExternal('https://hub.docker.com')}
          >
            Docker Hub
          </button>
        </div>
      </Card>
    </div>
  )
}
