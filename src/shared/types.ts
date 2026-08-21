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
  // sbx has no way to query GPU-passthrough status after creation (no field on `sbx ls --json`,
  // no per-sandbox inspect command) — this is this app's own local record of whether --gpu was
  // passed at creation time through this app, same honest "local tracking, not live state"
  // posture as lastAppliedPolicyTier. Populated main-process-side by enriching the raw `sbx ls`
  // result, not something the CLI itself reports.
  gpu: boolean
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
  // (Experimental) NVIDIA VFIO GPU passthrough — confirmed live via `sbx run --help`/`sbx create
  // --help`: "Linux x86_64, single NVIDIA GPU; requires one-time privileged host setup." Must be
  // set at creation time; a no-op on an existing sandbox, with no equivalent recreate-in-place
  // path (unlike kits' `sbx kit add`).
  gpu?: boolean
}

// Mirrors `sbx settings get feature.sandbox-gpu`'s real JSON shape (confirmed live, sbx v0.38.0)
// — feature.* settings are their own `json`-typed setting, not a plain bool, so the evaluated
// value is always this shape even without --json. `variant`/`variantPayload` are for gradual
// rollouts and aren't used here; only `enabled` matters for this app's on/off toggle.
export interface GpuFeatureStatus {
  enabled: boolean
  variant: string
  variantPayload: string
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
  // Claude-only, from the headless protocol's own {"type":"result",...} event (confirmed to
  // exist in the wire protocol, previously ignored) — the real "this turn is fully done"
  // signal, driving chatStore's turnActive so both the Stop button and the "thinking" bubble
  // stay visible for the turn's whole duration (tool calls in progress, more text still to
  // come), not just its opening gap.
  | { type: 'turn_end' }
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

// Confirmed live via `sbx secret set --help` (sbx v0.38.0). Only `openai` accepts --oauth;
// `anthropic` explicitly refuses it ("sign in from inside the Claude sandbox" instead) — that
// path reuses the existing pty-based Claude login flow (`loginClaude`), not this list.
export const SECRET_SERVICES = [
  'anthropic',
  'cursor',
  'droid',
  'github',
  'google',
  'groq',
  'mistral',
  'nebius',
  'openai',
  'openrouter',
  'xai'
] as const
export type SecretService = (typeof SECRET_SERVICES)[number]

// scope is "(global)" or a sandbox name, exactly as `sbx secret ls` prints it. status is the
// raw SECRET column text ("(stored)" / "(oauth configured)") — kept as free text rather than a
// closed enum since only those two values have been confirmed live.
export interface SecretEntry {
  scope: string
  type: string
  name: string
  status: string
}

// Password-manager integration for the Secrets page's plain-API-key input path — see
// src/main/passwordManager.ts. `signedIn` is null when the CLI itself isn't installed (no
// sign-in state to report); `detail` is a short human-readable status/error hint for the UI.
export type PasswordManagerId = 'op' | 'bw'

export interface PasswordManagerInfo {
  id: PasswordManagerId
  label: string
  available: boolean
  signedIn: boolean | null
  detail: string | null
}

// Ground-truth shape confirmed live against `sbx diagnose -o json` (sbx v0.38.0). status is one
// of "pass" | "warn" | "fail" | "skip" per the CLI's own summary counts, kept as free text since
// only those four have been observed.
export interface DiagnoseCheck {
  name: string
  status: string
  message: string
  detail: string
  hint: string
}

export interface DiagnoseResult {
  version: string
  checks: DiagnoseCheck[]
  summary: { pass: number; warn: number; fail: number; skip: number }
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

// A kit reference is a local directory path, a local ZIP file path, an OCI registry reference
// (ghcr.io/org/kit:1.0), or a git URL (git+https://...#dir=...) — confirmed live via
// `sbx kit inspect/add/validate --help`. The UI already knows which kind was picked (a native
// file dialog vs. a free-text field), so this is threaded through explicitly rather than
// re-derived by guessing at the reference string's shape.
export type KitSourceType = 'local' | 'oci' | 'git'

// `sbx` has no command to list which kits are applied to a sandbox, and no `kit remove` at
// all (confirmed live via `sbx --help`/`sbx kit --help`) — kits can only ever be added, never
// queried back or removed, through the CLI. This library is this app's own local record of
// kits it has successfully applied (at sandbox-create time or via the sandbox detail page's
// Kits tab) — it is honestly incomplete for kits applied via the CLI directly, the same
// "local tracking, not live state" posture as `lastAppliedPolicyTier`.
export interface KitLibraryEntry {
  id: string
  // For 'local' kits this is a path inside this app's own storage (a copy made at first use,
  // so it survives the original source folder being moved/deleted) — always what's actually
  // passed to `sbx kit add`/`inspect` on reuse. For 'oci'/'git' it's just the reference string,
  // already portable and re-fetchable from origin, so there's nothing to copy.
  reference: string
  sourceType: KitSourceType
  // Only meaningful for 'local' kits: the original path the user picked, kept for display/
  // provenance even after the file itself has been copied into app storage under `reference`.
  originalReference: string
  manifest: KitDetails
  firstUsedAt: string
  lastUsedAt: string
  appliedTo: string[]
}
