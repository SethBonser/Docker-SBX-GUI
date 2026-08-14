import { useQuery } from '@tanstack/react-query'
import type {
  ClaudePermissionMode,
  DefaultView,
  HealthStatus,
  KitLibraryEntry,
  McpAuthStatus,
  McpServerSummary,
  PasswordManagerInfo,
  PolicyRule,
  PolicyTier,
  PortMapping,
  SandboxSummary,
  SecretEntry
} from '@shared/types'

export function useHealth() {
  return useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: () => window.sbxApi.getHealth()
  })
}

export function useSandboxes() {
  return useQuery<SandboxSummary[]>({
    queryKey: ['sandboxes'],
    queryFn: () => window.sbxApi.listSandboxes()
  })
}

export function useDefaultView() {
  return useQuery<DefaultView>({
    queryKey: ['settings', 'defaultView'],
    queryFn: () => window.sbxApi.getDefaultView(),
    staleTime: Infinity,
    refetchInterval: false
  })
}

export function useDefaultPermissionMode() {
  return useQuery<ClaudePermissionMode>({
    queryKey: ['settings', 'defaultPermissionMode'],
    queryFn: () => window.sbxApi.getDefaultPermissionMode(),
    staleTime: Infinity,
    refetchInterval: false
  })
}

export function usePorts(sandboxName: string) {
  return useQuery<PortMapping[]>({
    queryKey: ['ports', sandboxName],
    queryFn: () => window.sbxApi.listPorts(sandboxName)
  })
}

/** Omit sandboxName (or pass undefined) for the unscoped, global rule set. */
export function usePolicyRules(sandboxName?: string) {
  return useQuery<PolicyRule[]>({
    queryKey: ['policy', sandboxName ?? 'global'],
    queryFn: () => window.sbxApi.policyList(sandboxName)
  })
}

export function usePolicyLog(sandboxName?: string) {
  return useQuery({
    queryKey: ['policyLog', sandboxName ?? 'global'],
    queryFn: () => window.sbxApi.policyLog(sandboxName, 30)
  })
}

/** Only reflects a tier applied through this app's own switcher — see settings.ts for why. */
export function useLastAppliedPolicyTier() {
  return useQuery<PolicyTier | null>({
    queryKey: ['settings', 'lastAppliedPolicyTier'],
    queryFn: () => window.sbxApi.getLastAppliedPolicyTier()
  })
}

export function useMcpServers() {
  return useQuery<McpServerSummary[]>({
    queryKey: ['mcp', 'servers'],
    queryFn: () => window.sbxApi.mcpList()
  })
}

/**
 * `sbx mcp auth status --all` only returns entries for servers that actually use OAuth — a
 * registered server missing from this list is either a local-stdio server or a remote one with
 * no OAuth requirement, not a fetch failure. The page treats "missing" as "no auth needed".
 */
export function useMcpAuthStatus() {
  return useQuery<McpAuthStatus[]>({
    queryKey: ['mcp', 'authStatus'],
    queryFn: () => window.sbxApi.mcpAuthStatus()
  })
}

/** All entries across every scope (global + every sandbox) — the Secrets page groups by service itself. */
export function useSecrets() {
  return useQuery<SecretEntry[]>({
    queryKey: ['secrets'],
    queryFn: () => window.sbxApi.secretList()
  })
}

/**
 * Detected password-manager CLIs (op/bw) and their sign-in status — refetched periodically since
 * a vault can lock or a CLI can be installed mid-session without the app restarting.
 */
export function usePasswordManagers() {
  return useQuery<PasswordManagerInfo[]>({
    queryKey: ['passwordManagers'],
    queryFn: () => window.sbxApi.listPasswordManagers(),
    refetchInterval: 30_000
  })
}

/**
 * This app's own local record of kits it has successfully applied — sbx has no way to list or
 * remove kits, only add them, so this is honestly incomplete for kits applied via the CLI
 * directly (same posture as useLastAppliedPolicyTier above).
 */
export function useKitLibrary() {
  return useQuery<KitLibraryEntry[]>({
    queryKey: ['kitLibrary'],
    queryFn: () => window.sbxApi.listKitLibrary()
  })
}
