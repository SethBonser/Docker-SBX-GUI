import type {
  KitDetails,
  McpAuthStatus,
  McpServerDetails,
  McpServerSummary,
  PolicyRule,
  PortMapping,
  SandboxStatus,
  SandboxSummary,
  SecretEntry
} from '@shared/types'

// Ground-truth shape confirmed against a live `sbx ls --json` (sbx v0.38.0):
// { "sandboxes": [ { name, id, agent, status, ports?: [...], workspaces: [...] } ] }
// The `ports` key is omitted entirely (not `[]`) when no ports are published.
interface RawPort {
  host_ip: string
  host_port: number
  sandbox_port: number
  protocol: string
}

interface RawSandbox {
  name: string
  id: string
  agent: string
  status: string
  ports?: RawPort[]
  workspaces: string[]
}

interface RawLsOutput {
  sandboxes: RawSandbox[]
}

function toSandboxStatus(status: string): SandboxStatus {
  if (status === 'running') return 'running'
  if (status === 'stopped') return 'stopped'
  return 'unknown'
}

function toPortMapping(raw: RawPort): PortMapping {
  return {
    hostIp: raw.host_ip,
    hostPort: raw.host_port,
    sandboxPort: raw.sandbox_port,
    protocol: raw.protocol as PortMapping['protocol']
  }
}

// `gpu` is always false here — confirmed live that `sbx ls --json` carries no such field, so it
// gets filled in by the IPC handler (registerHandlers.ts) from this app's own local record
// instead of being parsed from the CLI's own output.
export function parseLsJson(stdout: string): SandboxSummary[] {
  const parsed = JSON.parse(stdout) as RawLsOutput
  return parsed.sandboxes.map((s) => ({
    name: s.name,
    agent: s.agent,
    status: toSandboxStatus(s.status),
    ports: (s.ports ?? []).map(toPortMapping),
    workspace: s.workspaces[0] ?? '',
    gpu: false
  }))
}

export function parsePortsJson(stdout: string): PortMapping[] {
  const parsed = JSON.parse(stdout) as RawPort[]
  return parsed.map(toPortMapping)
}

export function parseKitInspectJson(stdout: string): KitDetails {
  return JSON.parse(stdout) as KitDetails
}

interface RawPolicyRule {
  id: string
  name: string
  policy_id: string
  scope: string
  applies_to: string
  resource_type: string
  decision: string
  resources: string[]
  origin: string
  layer: string
  status: string
  editable: boolean
  sandbox_id?: string
}

interface RawPolicyLsOutput {
  rules: RawPolicyRule[]
}

// `sbx mcp ls`/`inspect` have no --json flag (confirmed live) — parsed defensively from the
// text tables/blocks rather than a stable structured contract.

export function parseMcpLsText(stdout: string): McpServerSummary[] {
  const lines = stdout
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0 || /^no mcp servers registered/i.test(lines[0])) return []
  // Header row ("NAME  TYPE  URL/COMMAND") is skipped; columns are padded with 2+ spaces.
  return lines.slice(1).map((line) => {
    const [name = '', type = '', urlOrCommand = ''] = line.split(/\s{2,}/)
    return { name, type, urlOrCommand }
  })
}

export function parseMcpInspectText(stdout: string): McpServerDetails {
  const fields: Record<string, string> = {}
  let hasOAuth = false
  let oauthRequired = false
  let issuer: string | undefined
  let registration: string | undefined

  for (const rawLine of stdout.split('\n')) {
    const trimmed = rawLine.trim()
    const idx = trimmed.indexOf(':')
    if (!trimmed || idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (key === 'Issuer') issuer = value
    else if (key === 'Registration') registration = value
    else if (key === 'OAuth') {
      hasOAuth = true
      oauthRequired = /required/i.test(value)
    } else {
      fields[key] = value
    }
  }

  return {
    name: fields.Name ?? '',
    type: fields.Type ?? '',
    urlOrCommand: fields.URL ?? fields.Command ?? '',
    transport: fields.Transport,
    oauth: hasOAuth ? { required: oauthRequired, issuer, registration } : undefined
  }
}

interface RawMcpAuthStatus {
  server_name: string
  status: string
}

export function parseMcpAuthStatusJson(stdout: string): McpAuthStatus[] {
  const parsed = JSON.parse(stdout) as RawMcpAuthStatus[]
  return parsed.map((r) => ({ serverName: r.server_name, status: r.status }))
}

// `sbx secret ls` has no --json flag (confirmed live) — parsed from its text table
// ("SCOPE  TYPE  NAME  SECRET", scope is "(global)" or a sandbox name). An unmatched filter
// prints a plain "No secrets found for ..." sentence instead of a table, so anything without
// the SCOPE header is treated as empty rather than guessed at.
export function parseSecretLsText(stdout: string): SecretEntry[] {
  const lines = stdout
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0 || !/^SCOPE\s/i.test(lines[0])) return []
  return lines.slice(1).map((line) => {
    const [scope = '', type = '', name = '', status = ''] = line.split(/\s{2,}/)
    return { scope, type, name, status }
  })
}

export function parsePolicyLsJson(stdout: string): PolicyRule[] {
  const parsed = JSON.parse(stdout) as RawPolicyLsOutput
  return parsed.rules.map((r) => ({
    id: r.id,
    name: r.name,
    policyId: r.policy_id,
    scope: r.scope,
    appliesTo: r.applies_to,
    resourceType: r.resource_type,
    decision: r.decision === 'deny' ? 'deny' : 'allow',
    resources: r.resources,
    origin: r.origin,
    layer: r.layer,
    status: r.status,
    editable: r.editable,
    sandboxId: r.sandbox_id
  }))
}
