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
