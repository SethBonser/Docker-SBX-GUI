import Store from 'electron-store'
import type { ClaudePermissionMode, DefaultView, PolicyTier } from '@shared/types'

interface SettingsSchema {
  defaultView: DefaultView
  defaultPermissionMode: ClaudePermissionMode
  // Tracks the tier last applied via this app's own tier switcher, purely for the GUI's
  // "selected" indicator. sbx exposes no way to query which tier is currently active, so this
  // is unknown (null) until the user applies one from here — it does not reflect tiers set via
  // the sbx CLI directly or the tier auto-initialized on first sandbox creation.
  lastAppliedPolicyTier: PolicyTier | null
  // Names of sandboxes created with --gpu through this app. Same posture as lastAppliedPolicyTier
  // above: sbx has no way to query GPU-passthrough status on an existing sandbox (no field on
  // `sbx ls --json`, no inspect command), so this is honestly local — a sandbox created with
  // --gpu via the CLI directly won't show up here.
  gpuEnabledSandboxes: string[]
}

const store = new Store<SettingsSchema>({
  defaults: {
    defaultView: 'chat',
    defaultPermissionMode: 'default',
    lastAppliedPolicyTier: null,
    gpuEnabledSandboxes: []
  }
})

export function getDefaultView(): DefaultView {
  return store.get('defaultView')
}

export function setDefaultView(view: DefaultView): void {
  store.set('defaultView', view)
}

export function getDefaultPermissionMode(): ClaudePermissionMode {
  return store.get('defaultPermissionMode')
}

export function setDefaultPermissionMode(mode: ClaudePermissionMode): void {
  store.set('defaultPermissionMode', mode)
}

export function getLastAppliedPolicyTier(): PolicyTier | null {
  return store.get('lastAppliedPolicyTier')
}

export function setLastAppliedPolicyTier(tier: PolicyTier | null): void {
  store.set('lastAppliedPolicyTier', tier)
}

export function getGpuEnabledSandboxes(): string[] {
  return store.get('gpuEnabledSandboxes')
}

export function markSandboxGpuEnabled(name: string): void {
  const names = store.get('gpuEnabledSandboxes')
  if (!names.includes(name)) store.set('gpuEnabledSandboxes', [...names, name])
}

/** Called on removal so a later sandbox reusing the same name doesn't inherit a stale badge. */
export function clearSandboxGpuEnabled(name: string): void {
  const names = store.get('gpuEnabledSandboxes')
  store.set(
    'gpuEnabledSandboxes',
    names.filter((n) => n !== name)
  )
}
