import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

let cachedPath: string | null = null

/**
 * node-pty's Windows implementation needs a fully-qualified executable path — unlike
 * child_process.spawn/execFile, it does not search PATH itself. Regular (non-pty) sbxCli
 * calls don't need this; only pty-based sessions (chat fallback adapter, the Claude
 * OAuth login flow) do.
 */
export async function resolveSbxBinaryPath(command = 'sbx'): Promise<string> {
  if (/^[a-zA-Z]:[\\/]/.test(command) || command.startsWith('\\\\')) return command
  if (cachedPath) return cachedPath

  const finder = process.platform === 'win32' ? 'where' : 'which'
  const { stdout } = await execFileAsync(finder, [command])
  const first = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean)
  if (!first) throw new Error(`Could not resolve "${command}" on PATH.`)
  cachedPath = first
  return cachedPath
}
