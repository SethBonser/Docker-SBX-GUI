import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  ClaudePermissionMode,
  CreateSandboxOptions,
  DefaultView,
  McpAddOptions,
  PolicyTier
} from '@shared/types'

export function useCreateSandbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (opts: CreateSandboxOptions) => window.sbxApi.createSandbox(opts),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
  })
}

export function useStartSandbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => window.sbxApi.startSandbox(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
  })
}

export function useStopSandboxes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (names: string[]) => window.sbxApi.stopSandboxes(names),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
  })
}

export function useRemoveSandboxes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (names: string[]) => window.sbxApi.removeSandboxes(names),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
  })
}

export function useSetDefaultView() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (view: DefaultView) => window.sbxApi.setDefaultView(view),
    onSuccess: (_data, view) => queryClient.setQueryData(['settings', 'defaultView'], view)
  })
}

export function useSetDefaultPermissionMode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (mode: ClaudePermissionMode) => window.sbxApi.setDefaultPermissionMode(mode),
    onSuccess: (_data, mode) => queryClient.setQueryData(['settings', 'defaultPermissionMode'], mode)
  })
}

export function useKitInspect() {
  return useMutation({
    mutationFn: (reference: string) => window.sbxApi.kitInspect(reference)
  })
}

export function useKitValidate() {
  return useMutation({
    mutationFn: (reference: string) => window.sbxApi.kitValidate(reference)
  })
}

export function usePublishPort(sandboxName: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (spec: string) => window.sbxApi.publishPort(sandboxName, spec),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ports', sandboxName] })
  })
}

export function useUnpublishPort(sandboxName: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (spec: string) => window.sbxApi.unpublishPort(sandboxName, spec),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ports', sandboxName] })
  })
}

/** Omit sandboxName for an unscoped, global rule. */
export function useAllowNetwork(sandboxName?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (resources: string) => window.sbxApi.policyAllowNetwork(resources, sandboxName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['policy', sandboxName ?? 'global'] })
  })
}

export function useDenyNetwork(sandboxName?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (resources: string) => window.sbxApi.policyDenyNetwork(resources, sandboxName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['policy', sandboxName ?? 'global'] })
  })
}

export function useRemoveNetworkRule(sandboxName?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (opts: { id?: string; resource?: string }) =>
      window.sbxApi.policyRemoveNetwork({ ...opts, sandboxName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['policy', sandboxName ?? 'global'] })
  })
}

export function useInitPolicyTier() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tier: PolicyTier) => window.sbxApi.policyInit(tier),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy'] })
      queryClient.invalidateQueries({ queryKey: ['settings', 'lastAppliedPolicyTier'] })
    }
  })
}

export function useResetPolicy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => window.sbxApi.policyReset(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy'] })
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
      queryClient.invalidateQueries({ queryKey: ['settings', 'lastAppliedPolicyTier'] })
    }
  })
}

export function useAddMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, opts }: { name: string; opts: McpAddOptions }) => window.sbxApi.mcpAdd(name, opts),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp'] })
  })
}

/** Long-running: blocks on the browser OAuth consent until it completes or the 5-minute timeout hits. */
export function useAuthorizeMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => window.sbxApi.mcpAuth(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp', 'authStatus'] })
  })
}

export function useRemoveMcpAuth() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => window.sbxApi.mcpAuthRemove(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp', 'authStatus'] })
  })
}

export function useRemoveMcpServer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => window.sbxApi.mcpRemove(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp'] })
  })
}

export function useLoadMcpServer() {
  return useMutation({
    mutationFn: ({ name, sandboxName }: { name: string; sandboxName: string }) =>
      window.sbxApi.mcpLoad(name, sandboxName)
  })
}

export function useSetSecret() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ service, value, sandboxName }: { service: string; value: string; sandboxName?: string }) =>
      window.sbxApi.secretSet(service, value, { sandboxName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['secrets'] })
  })
}

/** Long-running: blocks on the browser OAuth consent (openai only — see sbxCli.ts). */
export function useSetSecretOAuth() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (service: string) => window.sbxApi.secretSetOAuth(service),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['secrets'] })
  })
}

export function useRemoveSecret() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ service, sandboxName }: { service: string; sandboxName?: string }) =>
      window.sbxApi.secretRemove(service, { sandboxName }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['secrets'] })
  })
}

/** Disruptive: stops/restarts every running sandbox's connection to the daemon. Caller confirms first. */
function useDaemonAction(action: 'start' | 'stop' | 'restart') {
  const queryClient = useQueryClient()
  const fn =
    action === 'start'
      ? window.sbxApi.daemonStart
      : action === 'stop'
        ? window.sbxApi.daemonStop
        : window.sbxApi.daemonRestart
  return useMutation({
    mutationFn: () => fn(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
    }
  })
}

export function useDaemonStart() {
  return useDaemonAction('start')
}

export function useDaemonStop() {
  return useDaemonAction('stop')
}

export function useDaemonRestart() {
  return useDaemonAction('restart')
}

export function useDiagnose() {
  return useMutation({
    mutationFn: () => window.sbxApi.diagnose()
  })
}
