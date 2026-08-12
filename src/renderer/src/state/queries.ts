import { useQuery } from '@tanstack/react-query'
import type { HealthStatus, SandboxSummary } from '@shared/types'

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
