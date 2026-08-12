import { BrowserWindow, dialog } from 'electron'

export async function pickWorkspaceFolder(win: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Select workspace folder'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/** Kit references are a local directory or a ZIP file — let the user pick either in one dialog. */
export async function pickKitReference(win: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'openFile'],
    filters: [{ name: 'Kit (directory or ZIP)', extensions: ['zip'] }],
    title: 'Select a kit directory or ZIP file'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}
