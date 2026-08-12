import { useQuery } from '@tanstack/react-query'
import type {
  ClaudePermissionMode,
  DefaultView,
  HealthStatus,
  McpAuthStatus,
  McpServerSummary,
  PolicyRule,
  PolicyTier,
  PortMapping,
  SandboxSummary
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
