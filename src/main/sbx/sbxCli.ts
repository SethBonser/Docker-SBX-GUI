import { execFile } from 'child_process'
import { SbxCliError, classifyFailure } from './errors'
import {
  parseLsJson,
  parseKitInspectJson,
  parsePortsJson,
  parsePolicyLsJson,
  parseMcpLsText,
  parseMcpInspectText,
  parseMcpAuthStatusJson
} from './parsers'
import { runOAuthFlow } from './oauthFlow'
import type {
  CreateSandboxOptions,
  KitDetails,
  KitValidationResult,
  McpAddOptions,
  McpAuthStatus,
  McpServerDetails,
  McpServerSummary,
  PolicyLogResult,
  PolicyRule,
  PolicyTier,
  PortMapping,
  SandboxSummary
} from '@shared/types'

interface RunResult {
  stdout: string
  stderr: string
  code: number
}

let binaryPath = 'sbx'

/** Override the resolved sbx binary path (wired to a Settings screen in a later milestone). */
export function setSbxBinaryPath(path: string): void {
  binaryPath = path
}

function run(args: string[], opts: { timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      binaryPath,
      args,
      { timeout: opts.timeoutMs ?? 15_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new SbxCliError('BinaryNotFound', `Could not find the "sbx" executable on PATH.`, {
              stderr: String(error.message)
            })
          )
          return
        }
        const code = (error as NodeJS.ErrnoException & { code?: number })?.code as number | undefined
        const exitCode = typeof code === 'number' ? code : error ? 1 : 0
        if (error && exitCode !== 0) {
          reject(classifyFailure(stderr, exitCode))
          return
        }
        resolve({ stdout, stderr, code: exitCode })
      }
    )
  })
}

export interface SbxVersionInfo {
  raw: string
  version: string | null
}

async function version(): Promise<SbxVersionInfo> {
  const { stdout } = await run(['version'])
  const match = stdout.match(/v?(\d+\.\d+\.\d+)/)
  return { raw: stdout.trim(), version: match ? match[1] : null }
}

export type DaemonStatusValue = 'running' | 'stopped' | 'unknown'

async function daemonStatus(): Promise<DaemonStatusValue> {
  try {
    const { stdout } = await run(['daemon', 'status'])
    if (/status:\s*running/i.test(stdout)) return 'running'
    if (/status:\s*stopped/i.test(stdout)) return 'stopped'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Confirmed live: `sbx login` when already authenticated prints "You are signed in
 * [username: X]" and exits 0 immediately — it does NOT re-trigger an OAuth flow, so this
 * is safe to call as a status check. Only call this after health-checking loggedIn=true;
 * calling it while logged out would block on an interactive flow (the base run() timeout
 * is the safety net, not the intended path).
 */
async function whoami(): Promise<string | null> {
  const { stdout } = await run(['login'])
  const match = stdout.match(/username:\s*([^\]]+)\]/i)
  return match ? match[1].trim() : null
}

/** Spawns the interactive `sbx login` OAuth flow and opens the printed sign-in URL in the system browser. */
async function login(onUrl?: (url: string) => void): Promise<void> {
  await runOAuthFlow(['login'], { onUrl })
}

/**
 * `sbx logout` also stops every running sandbox — the renderer confirms with the user before
 * calling this. `-y` skips sbx's own confirmation prompt, which would otherwise hang forever
 * since this process is never attached to a TTY.
 */
async function logout(): Promise<void> {
  await run(['logout', '-y'])
}

async function ls(): Promise<SandboxSummary[]> {
  const { stdout } = await run(['ls', '--json'])
  return parseLsJson(stdout)
}

/** Image pulls on first use can take minutes; give create a much longer budget than other commands. */
async function create(opts: CreateSandboxOptions): Promise<void> {
  const args = ['create', '--name', opts.name, '-q']
  if (opts.memory) args.push('-m', opts.memory)
  if (opts.cpus) args.push('--cpus', String(opts.cpus))
  for (const p of opts.publish ?? []) args.push('-p', p)
  for (const d of opts.denyNetwork ?? []) args.push('--deny-network', d)
  for (const k of opts.kits ?? []) args.push('--kit', k)
  if (opts.template) args.push('-t', opts.template)
  args.push(opts.agent, ...opts.workspaces)

  await run(args, { timeoutMs: 10 * 60_000 })
}

async function stop(names: string[]): Promise<void> {
  await run(['stop', ...names])
}

/**
 * There is no dedicated `sbx start` command — confirmed live that `sbx exec` starts a
 * stopped sandbox as a side effect before running its command. `true` is a universal
 * POSIX no-op, so this works for any agent regardless of whether it has a chat adapter yet.
 */
async function start(name: string): Promise<void> {
  await run(['exec', name, 'true'], { timeoutMs: 60_000 })
}

/** Always pass --force: our spawned process never has a TTY, so the interactive confirmation prompt would hang forever. */
async function rm(names: string[]): Promise<void> {
  await run(['rm', '--force', ...names])
}

async function listPorts(sandboxName: string): Promise<PortMapping[]> {
  const { stdout } = await run(['ports', sandboxName, '--json'])
  return parsePortsJson(stdout)
}

async function publishPort(sandboxName: string, spec: string): Promise<void> {
  await run(['ports', sandboxName, '--publish', spec])
}

async function unpublishPort(sandboxName: string, spec: string): Promise<void> {
  await run(['ports', sandboxName, '--unpublish', spec])
}

async function kitInspect(reference: string): Promise<KitDetails> {
  const { stdout } = await run(['kit', 'inspect', reference, '--json'])
  return parseKitInspectJson(stdout)
}

/** Validation failure is an expected outcome the UI needs to show, not an exceptional error. */
async function kitValidate(reference: string): Promise<KitValidationResult> {
  try {
    const { stdout } = await run(['kit', 'validate', reference])
    return { valid: true, message: stdout.trim() }
  } catch (err) {
    if (err instanceof SbxCliError) {
      return { valid: false, message: err.stderr.trim() || err.message }
    }
    throw err
  }
}

async function policyList(sandboxName?: string): Promise<PolicyRule[]> {
  const args = ['policy', 'ls']
  if (sandboxName) args.push(sandboxName)
  args.push('--json')
  const { stdout } = await run(args)
  return parsePolicyLsJson(stdout)
}

async function policyAllowNetwork(resources: string, sandboxName?: string): Promise<void> {
  const args = ['policy', 'allow', 'network']
  if (sandboxName) args.push('--sandbox', sandboxName)
  args.push(resources)
  await run(args)
}

async function policyDenyNetwork(resources: string, sandboxName?: string): Promise<void> {
  const args = ['policy', 'deny', 'network']
  if (sandboxName) args.push('--sandbox', sandboxName)
  args.push(resources)
  await run(args)
}

async function policyRemoveNetwork(opts: { id?: string; resource?: string; sandboxName?: string }): Promise<void> {
  const args = ['policy', 'rm', 'network']
  if (opts.sandboxName) args.push('--sandbox', opts.sandboxName)
  if (opts.id) args.push('--id', opts.id)
  if (opts.resource) args.push('--resource', opts.resource)
  await run(args)
}

/**
 * Field names beyond allowed_hosts/blocked_hosts weren't confirmed against real traffic (the
 * test sandbox had none logged yet) — kept loosely typed and rendered generically in the UI
 * rather than guessing a precise per-entry shape.
 */
async function policyLog(sandboxName?: string, limit?: number): Promise<PolicyLogResult> {
  const args = ['policy', 'log']
  if (sandboxName) args.push(sandboxName)
  args.push('--json')
  if (limit) args.push('--limit', String(limit))
  const { stdout } = await run(args)
  const parsed = JSON.parse(stdout) as {
    allowed_hosts?: Record<string, unknown>[]
    blocked_hosts?: Record<string, unknown>[]
  }
  return { allowedHosts: parsed.allowed_hosts ?? [], blockedHosts: parsed.blocked_hosts ?? [] }
}

async function policyInit(tier: PolicyTier): Promise<void> {
  await run(['policy', 'init', tier])
}

/**
 * Confirmed live: destructive — deletes the local policy store and restarts the daemon,
 * stopping every currently running sandbox. `-f` skips the confirmation prompt that would
 * otherwise hang forever (never attached to a TTY). The caller (GlobalPolicy page) must get
 * explicit confirmation from the user before calling this — it's not a casual toggle.
 */
async function policyReset(): Promise<void> {
  await run(['policy', 'reset', '-f'], { timeoutMs: 30_000 })
}

async function mcpList(): Promise<McpServerSummary[]> {
  const { stdout } = await run(['mcp', 'ls'])
  return parseMcpLsText(stdout)
}

async function mcpInspect(name: string): Promise<McpServerDetails> {
  const { stdout } = await run(['mcp', 'inspect', name])
  return parseMcpInspectText(stdout)
}

/**
 * Mirrors the full `sbx mcp add` flag set (see McpAddOptions). Always adds --skip_auth for a
 * --url server: registration and authorization are kept as two explicit steps in the UI
 * (register, then a separate "Authorize" action) rather than an add that might silently kick
 * off a browser OAuth flow the user didn't ask for yet. --command servers have no OAuth concept
 * so --skip_auth is omitted for them.
 */
async function mcpAdd(name: string, opts: McpAddOptions): Promise<void> {
  const args = ['mcp', 'add', name]
  if (opts.url) args.push('--url', opts.url)
  if (opts.command) args.push('--command', opts.command)
  if (opts.args?.length) args.push('--args', opts.args.join(','))
  if (opts.dir) args.push('--dir', opts.dir)
  if (opts.local) args.push('--local')
  if (opts.clientId) args.push('--client-id', opts.clientId)
  if (opts.oauthAuthorizationServer) args.push('--oauth-authorization-server', opts.oauthAuthorizationServer)
  for (const scope of opts.scopes ?? []) args.push('--scope', scope)
  if (opts.skipSsrfCheck) args.push('--skip-ssrf-check')
  if (opts.url) args.push('--skip_auth')
  await run(args, { timeoutMs: 30_000 })
}

/**
 * Confirmed live: `sbx mcp auth <name>` prints "Open this URL to authorize..." followed by a
 * URL, then blocks until the browser-based OAuth consent completes — identical shape to
 * `sbx login`, so it reuses the same runOAuthFlow helper.
 */
async function mcpAuth(name: string): Promise<void> {
  await runOAuthFlow(['mcp', 'auth', name])
}

async function mcpAuthStatus(): Promise<McpAuthStatus[]> {
  const { stdout } = await run(['mcp', 'auth', 'status', '--all', '--format', 'json'])
  return parseMcpAuthStatusJson(stdout)
}

async function mcpAuthRemove(name: string): Promise<void> {
  await run(['mcp', 'auth', 'rm', name])
}

async function mcpRemove(name: string): Promise<void> {
  await run(['mcp', 'rm', name])
}

async function mcpLoad(name: string, sandboxName: string): Promise<void> {
  await run(['mcp', 'load', name, '--sandbox', sandboxName], { timeoutMs: 30_000 })
}

export const sbxCli = {
  version,
  daemonStatus,
  whoami,
  login,
  logout,
  ls,
  create,
  stop,
  start,
  rm,
  listPorts,
  publishPort,
  unpublishPort,
  kitInspect,
  kitValidate,
  policyList,
  policyAllowNetwork,
  policyDenyNetwork,
  policyRemoveNetwork,
  policyLog,
  policyInit,
  policyReset,
  mcpList,
  mcpInspect,
  mcpAdd,
  mcpAuth,
  mcpAuthStatus,
  mcpAuthRemove,
  mcpRemove,
  mcpLoad
}
