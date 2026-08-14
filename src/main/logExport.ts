import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { release as osRelease } from 'os'
import { join } from 'path'
import { app, dialog, type BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { sbxCli } from './sbx/sbxCli'

export interface LogExportResult {
  success: boolean
  path?: string
}

/**
 * Bundles the application log, a live `sbx diagnose` run, and version/platform info into one
 * plain-text file a tester saves via a normal save dialog and can send back when something goes
 * wrong — most of what would otherwise need to be asked for separately, in one attachment.
 * Deliberately doesn't fail the whole export if `sbx diagnose` itself errors (e.g. sbx isn't
 * installed) — that failure is itself useful diagnostic information, included inline instead of
 * aborting the export over it.
 *
 * Confirmed live (user report): without an explicit default folder, the save dialog just opens
 * wherever the OS last remembered — which for one tester was a folder they'd been using as a
 * sandbox *workspace*, not anywhere related to this app. Defaulting to a dedicated, clearly-named
 * folder under Documents avoids that — still just a starting point the dialog opens to, not a
 * forced location, so saving somewhere else is still one click away.
 */
export async function exportLogs(win: BrowserWindow): Promise<LogExportResult> {
  const exportsDir = join(app.getPath('documents'), 'Docker Sandbox GUI Logs')
  await mkdir(exportsDir, { recursive: true })

  const result = await dialog.showSaveDialog(win, {
    title: 'Export application logs',
    defaultPath: join(
      exportsDir,
      `docker-sandbox-gui-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`
    ),
    filters: [{ name: 'Text file', extensions: ['txt'] }]
  })
  if (result.canceled || !result.filePath) return { success: false }

  let diagnoseSection: string
  try {
    const diagnose = await sbxCli.diagnose()
    diagnoseSection = JSON.stringify(diagnose, null, 2)
  } catch (err) {
    diagnoseSection = `(sbx diagnose failed: ${(err as Error).message})`
  }

  const logPath = log.transports.file.getFile().path
  const logSection = existsSync(logPath)
    ? await readFile(logPath, 'utf-8')
    : '(no log file yet — nothing has been logged this run)'

  const bundle = [
    `Docker Sandbox GUI — log export`,
    `Generated: ${new Date().toISOString()}`,
    `App version: ${app.getVersion()}`,
    `Electron: ${process.versions.electron}`,
    `Platform: ${process.platform} ${process.arch} (${osRelease()})`,
    '',
    '===== sbx diagnose =====',
    diagnoseSection,
    '',
    '===== Application log =====',
    logSection
  ].join('\n')

  await writeFile(result.filePath, bundle, 'utf-8')
  return { success: true, path: result.filePath }
}
