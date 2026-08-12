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
}

const store = new Store<SettingsSchema>({
  defaults: { defaultView: 'chat', defaultPermissionMode: 'default', lastAppliedPolicyTier: null }
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
