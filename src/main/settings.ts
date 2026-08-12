import Store from 'electron-store'
import type { ClaudePermissionMode, DefaultView } from '@shared/types'

interface SettingsSchema {
  defaultView: DefaultView
  defaultPermissionMode: ClaudePermissionMode
}

const store = new Store<SettingsSchema>({
  defaults: { defaultView: 'chat', defaultPermissionMode: 'default' }
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
