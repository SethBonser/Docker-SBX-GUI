export type AgentType =
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'cursor'
  | 'docker-agent'
  | 'droid'
  | 'gemini'
  | 'kiro'
  | 'opencode'
  | 'shell'

export type SandboxStatus = 'running' | 'stopped' | 'unknown'

export interface PortMapping {
  hostIp?: string
  hostPort: number
  sandboxPort: number
  protocol: 'tcp' | 'udp' | 'tcp4' | 'tcp6' | 'udp4' | 'udp6'
}

export interface SandboxSummary {
  name: string
  agent: AgentType | string
  status: SandboxStatus
  ports: PortMapping[]
  workspace: string
}

export interface HealthStatus {
  binaryFound: boolean
  version: string | null
  daemonUp: boolean
  loggedIn: boolean
  username: string | null
}

export interface CreateSandboxOptions {
  agent: AgentType
  name: string
  workspaces: string[] // additional workspaces beyond the primary get ":ro" appended by the caller when read-only
  memory?: string // e.g. "1024m", "8g"
  cpus?: number
  publish?: string[] // [[HOST_IP:]HOST_PORT:]SANDBOX_PORT[/PROTOCOL]
  denyNetwork?: string[]
  kits?: string[] // kit references: directory, ZIP path, OCI ref, or git URL
  template?: string
}

// Ground-truth shape confirmed against a live `sbx kit inspect --json` (sbx v0.38.0, kit schemaVersion 2).
export interface KitCredentialInject {
  domain: string
  header?: string
  format?: string
}

export interface KitCredential {
  service: string
  description?: string
  required?: boolean
  apiKey?: {
    name: string
    inject: KitCredentialInject[]
  }
  oauth?: unknown
}

export interface KitCommand {
  command: string | string[]
  description?: string
  user?: string
  background?: boolean
}

export type DefaultView = 'chat' | 'terminal'

export interface PtyLoginResult {
  success: boolean
  message: string
}

export interface KitValidationResult {
  valid: boolean
  message: string
}

export type AgentSessionEvent =
  | { type: 'status'; status: 'connecting' | 'ready' | 'error' | 'exited' }
  | { type: 'assistant_message'; text: string; messageId: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'permission_denied'; toolUseId: string; toolName: string; reason: string }
  | { type: 'raw_output'; text: string } // generic fallback adapter only
  | { type: 'error'; message: string }
  // Confirmed live: the headless `system/init` event's `mcp_servers` array includes both the
  // sbx-mediated "mcp-gateway" AND Claude.ai's own native connectors (Gmail, Drive, etc. — the
  // same set the real `/mcp` picker shows), each with a "connected"/"needs-auth"/etc. status.
  // It's a one-time snapshot taken when the *first* message is sent (system/init doesn't fire
  // any earlier), so a connector whose discovery hadn't finished yet at that moment can be
  // missing or stale for the rest of the session — it does not live-update afterward.
  | { type: 'mcp_status'; servers: { name: string; status: string }[] }

// Confirmed live: headless stream-json mode auto-denies risky Bash commands (process
// substitution, complex chaining, etc.) with no bidirectional "ask and wait" channel — there
// is nothing to respond to per-request. The only real lever is the session-level mode it's
// launched with. All 6 of the CLI's --permission-mode choices were tested/reasoned through:
//   - "default"           simple commands pass, risky patterns auto-denied
//   - "acceptEdits"       identical to default for Bash — only auto-accepts file edits
//   - "auto"              gets risky commands through, but reasons/works around problems
//                         instead of just running them (~3x slower/costlier than bypass)
//   - "dontAsk"           MORE restrictive than default — blanket-denies Bash outright
//   - "bypassPermissions" everything allowed, fast, no denials
//   - "plan"              genuinely different: writes a plan and gets permanently stuck
//                         there — the tool needed to exit plan mode isn't available
//                         headlessly, so it never executes anything. Good for pure
//                         read-only exploration, not for getting things done.
//   - "manual"            excluded: needs a real TTY (hangs), same constraint as /login
export type ClaudePermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'auto'
  | 'dontAsk'
  | 'bypassPermissions'
  | 'plan'

// Ground-truth shape confirmed against a live `sbx policy ls --json` (sbx v0.38.0).
export interface PolicyRule {
  id: string
  name: string
  policyId: string
  scope: string // "global" or "sandbox:<name>"
  appliesTo: string
  resourceType: string // "network" | "filesystem:read" | "filesystem:write"
  decision: 'allow' | 'deny'
  resources: string[]
  origin: string // "local" | "scoped" | "org" | "kit"
  layer: string
  status: string
  editable: boolean
  sandboxId?: string
}

export interface PolicyLogResult {
  allowedHosts: Record<string, unknown>[]
  blockedHosts: Record<string, unknown>[]
}

export type PolicyTier = 'allow-all' | 'balanced' | 'deny-all'

export interface McpServerSummary {
  name: string
  type: string // "remote" | "local"
  urlOrCommand: string
}

// Mirrors the real flag set of `sbx mcp add` (confirmed live via --help, sbx v0.38.0). Exactly
// one of url/command should be set — url for a remote endpoint/manifest/registry/DHI ref,
// command for a local stdio server that runs as a host subprocess (dev-only, unsandboxed).
export interface McpAddOptions {
  url?: string
  command?: string
  args?: string[]
  dir?: string
  local?: boolean
  clientId?: string
  oauthAuthorizationServer?: string
  scopes?: string[]
  skipSsrfCheck?: boolean
}

export interface McpServerDetails {
  name: string
  type: string
  urlOrCommand: string
  transport?: string
  oauth?: {
    required: boolean
    issuer?: string
    registration?: string
  }
}

// "status" isn't a fixed enum in sbx's own docs beyond "unauthorized" (confirmed live) and the
// "expired" case implied by `sbx mcp auth`'s help text — rendered generically rather than
// mapped to a closed set.
export interface McpAuthStatus {
  serverName: string
  status: string
}

export interface KitDetails {
  manifest: {
    schemaVersion: string
    kind: 'mixin' | 'sandbox'
    name: string
    displayName?: string
    description?: string
  }
  requires?: { agent?: string }
  caps?: {
    network?: { allow?: string[]; deny?: string[] }
  }
  credentials?: KitCredential[]
  environment?: { variables?: Record<string, string> }
  commands?: {
    install?: KitCommand[]
    startup?: KitCommand[]
  }
  agentContext?: string
}
