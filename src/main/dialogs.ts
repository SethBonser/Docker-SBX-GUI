import { BrowserWindow, dialog } from 'electron'

export async function pickWorkspaceFolder(win: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Select workspace folder'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/**
 * Kit references are a local directory or a ZIP file, but on Windows and Linux a single
 * open dialog can't offer both — combining 'openDirectory' and 'openFile' in `properties`
 * makes Electron fall back to a folder-only picker, which hides all files (ZIPs included)
 * regardless of `filters`. So this is two separate single-purpose dialogs instead of one.
 */
export async function pickKitDirectory(win: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Select a kit directory'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export async function pickKitZip(win: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Kit ZIP', extensions: ['zip'] }],
    title: 'Select a kit ZIP file'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}
