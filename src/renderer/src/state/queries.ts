import { useQuery } from '@tanstack/react-query'
import type { ClaudePermissionMode, DefaultView, HealthStatus, SandboxSummary } from '@shared/types'

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
