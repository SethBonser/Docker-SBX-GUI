import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { useMcpAuthStatus, useMcpServers, useSandboxes } from '@renderer/state/queries'
import {
  useAddMcpServer,
  useAuthorizeMcpServer,
  useLoadMcpServer,
  useRemoveMcpAuth,
  useRemoveMcpServer
} from '@renderer/state/mutations'
import type { McpServerSummary } from '@shared/types'

function AuthBadge({ status }: { status?: string }): JSX.Element {
  if (!status) return <Badge tone="neutral">No OAuth needed</Badge>
  if (status === 'authorized') return <Badge tone="success">Authorized</Badge>
  return <Badge tone="warning">{status}</Badge>
}

function McpServerRow({
  server,
  authStatus
}: {
  server: McpServerSummary
  authStatus?: string
}): JSX.Element {
  const sandboxes = useSandboxes()
  const authorize = useAuthorizeMcpServer()
  const removeAuth = useRemoveMcpAuth()
  const removeServer = useRemoveMcpServer()
  const loadServer = useLoadMcpServer()
  const [authError, setAuthError] = useState<string | null>(null)
  const [loadTarget, setLoadTarget] = useState('')
  const [loadResult, setLoadResult] = useState<string | null>(null)

  const runningSandboxes = sandboxes.data?.filter((s) => s.status === 'running') ?? []
  const needsAuth = authStatus !== undefined
  const isAuthorized = authStatus === 'authorized'

  async function handleAuthorize(): Promise<void> {
    setAuthError(null)
    try {
      await authorize.mutateAsync(server.name)
    } catch (err) {
      setAuthError((err as Error).message)
    }
  }

  async function handleLoad(): Promise<void> {
    if (!loadTarget) return
    setLoadResult(null)
    try {
      await loadServer.mutateAsync({ name: server.name, sandboxName: loadTarget })
      setLoadResult(`Loaded into "${loadTarget}".`)
    } catch (err) {
      setLoadResult((err as Error).message)
    }
  }

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-200">{server.name}</span>
          <Badge tone="neutral">{server.type}</Badge>
          <AuthBadge status={authStatus} />
        </div>
        <button
          className="text-xs text-red-400 hover:text-red-300"
          onClick={() => removeServer.mutate(server.name)}
          disabled={removeServer.isPending}
        >
          remove server
        </button>
      </div>
      <div className="truncate text-xs text-slate-500" title={server.urlOrCommand}>
        {server.urlOrCommand}
      </div>

      {needsAuth && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={authorize.isPending} onClick={() => void handleAuthorize()}>
            {isAuthorized ? 'Reauthorize' : 'Authorize'}
          </Button>
          {isAuthorized && (
            <Button
              variant="ghost"
              disabled={removeAuth.isPending}
              onClick={() => removeAuth.mutate(server.name)}
            >
              Revoke access
            </Button>
          )}
          {authorize.isPending && (
            <span className="text-xs text-slate-400">Waiting on browser authorization…</span>
          )}
        </div>
      )}
      {authError && <p className="text-sm text-red-400">{authError}</p>}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
        <select
          value={loadTarget}
          onChange={(e) => setLoadTarget(e.target.value)}
          className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-100"
        >
          <option value="">Load into sandbox…</option>
          {runningSandboxes.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={!loadTarget || loadServer.isPending || (needsAuth && !isAuthorized)}
          onClick={() => void handleLoad()}
        >
          Load
        </Button>
        {loadTarget && (
          <Link
            to={`/sandboxes/${loadTarget}?tab=terminal`}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            Verify in Terminal →
          </Link>
        )}
        {needsAuth && !isAuthorized && (
          <span className="text-xs text-slate-500">Authorize before loading into a sandbox.</span>
        )}
      </div>
      {loadResult && <p className="text-xs text-slate-400">{loadResult}</p>}
    </Card>
  )
}

const inputClass =
  'rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600'

function RegisterServerForm(): JSX.Element {
  const addServer = useAddMcpServer()
  const [mode, setMode] = useState<'remote' | 'local'>('remote')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [dir, setDir] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [clientId, setClientId] = useState('')
  const [oauthAuthServer, setOauthAuthServer] = useState('')
  const [scopes, setScopes] = useState('')
  const [skipSsrfCheck, setSkipSsrfCheck] = useState(false)

  const canSubmit = name.trim() && (mode === 'remote' ? url.trim() : command.trim())

  async function handleRegister(): Promise<void> {
    if (!canSubmit) return
    const opts =
      mode === 'remote'
        ? {
            url: url.trim(),
            clientId: clientId.trim() || undefined,
            oauthAuthorizationServer: oauthAuthServer.trim() || undefined,
            scopes: scopes.trim() ? scopes.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
            skipSsrfCheck: skipSsrfCheck || undefined
          }
        : {
            command: command.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : undefined,
            dir: dir.trim() || undefined
          }
    await addServer.mutateAsync({ name: name.trim(), opts })
    setName('')
    setUrl('')
    setCommand('')
    setArgs('')
    setDir('')
    setClientId('')
    setOauthAuthServer('')
    setScopes('')
    setSkipSsrfCheck(false)
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-300">Register a server</h2>
      <div className="mt-2 flex gap-2">
        <Button variant={mode === 'remote' ? 'secondary' : 'ghost'} onClick={() => setMode('remote')}>
          Remote URL
        </Button>
        <Button variant={mode === 'local' ? 'secondary' : 'ghost'} onClick={() => setMode('local')}>
          Local command
        </Button>
      </div>

      {mode === 'remote' ? (
        <>
          <p className="mt-2 text-xs text-slate-500">
            Remote MCP endpoint URL, e.g. https://mcp.notion.com/mcp. Registering only stores the
            server — it won't trigger sign-in until you click Authorize below.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="name (e.g. notion)"
              className={`w-48 ${inputClass}`}
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp.example.com/mcp"
              className={`flex-1 ${inputClass}`}
            />
          </div>
          <button
            className="mt-2 text-xs text-indigo-400 hover:text-indigo-300"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'hide advanced OAuth options' : 'advanced OAuth options'}
          </button>
          {showAdvanced && (
            <div className="mt-2 flex flex-col gap-2 rounded-md border border-slate-800 p-3">
              <p className="text-xs text-slate-500">
                Only needed for a server with no discoverable OAuth registration endpoint (a
                pre-registered client), or one that needs hand-supplied auth-server metadata.
                Leave blank to let sbx auto-discover.
              </p>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="--client-id (pre-registered OAuth client id)"
                className={inputClass}
              />
              <input
                value={oauthAuthServer}
                onChange={(e) => setOauthAuthServer(e.target.value)}
                placeholder="--oauth-authorization-server (path or URL to RFC 8414 metadata)"
                className={inputClass}
              />
              <input
                value={scopes}
                onChange={(e) => setScopes(e.target.value)}
                placeholder="--scope values, comma-separated (e.g. read, write)"
                className={inputClass}
              />
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={skipSsrfCheck}
                  onChange={(e) => setSkipSsrfCheck(e.target.checked)}
                />
                Skip SSRF guard (host resolves to a private/internal address you trust)
              </label>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-xs text-amber-400">
            Runs as a subprocess on the host, outside the sandbox, with your full user
            permissions — no sandboxing, no supply-chain verification. Dev-only; don't point this
            at an untrusted executable.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="name (e.g. mytool)"
              className={`w-48 ${inputClass}`}
            />
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="command (e.g. node)"
              className={`w-48 ${inputClass}`}
            />
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="args, space-separated (e.g. server.js --port 4000)"
              className={`flex-1 ${inputClass}`}
            />
            <input
              value={dir}
              onChange={(e) => setDir(e.target.value)}
              placeholder="working directory (optional)"
              className={`w-56 ${inputClass}`}
            />
          </div>
        </>
      )}

      <div className="mt-2">
        <Button disabled={addServer.isPending || !canSubmit} onClick={() => void handleRegister()}>
          Register
        </Button>
      </div>
      {addServer.isError && (
        <p className="mt-1 text-sm text-red-400">{(addServer.error as Error).message}</p>
      )}
    </div>
  )
}

export function Mcp(): JSX.Element {
  const servers = useMcpServers()
  const authStatus = useMcpAuthStatus()

  const authStatusByName = new Map((authStatus.data ?? []).map((s) => [s.serverName, s.status]))

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">MCP servers</h1>
        <p className="mt-1 text-sm text-slate-400">
          Register MCP servers, authorize them, and attach them to running sandboxes.
        </p>
      </div>

      <RegisterServerForm />

      {servers.isLoading && <p className="text-sm text-slate-400">Loading MCP servers…</p>}
      {servers.isError && <p className="text-sm text-red-400">{(servers.error as Error).message}</p>}
      {servers.data && servers.data.length === 0 && (
        <p className="text-sm text-slate-500">No MCP servers registered yet.</p>
      )}

      <div className="flex flex-col gap-2">
        {servers.data?.map((s) => (
          <McpServerRow key={s.name} server={s} authStatus={authStatusByName.get(s.name)} />
        ))}
      </div>
    </div>
  )
}
