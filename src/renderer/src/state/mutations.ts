import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ClaudePermissionMode, CreateSandboxOptions, DefaultView } from '@shared/types'

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
