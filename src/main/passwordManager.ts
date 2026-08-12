import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PasswordManagerId, PasswordManagerInfo } from '@shared/types'

const execFileAsync = promisify(execFile)

/**
 * Detection/fetch layer for password-manager CLIs (1Password's `op`, Bitwarden's `bw`) — the
 * *input* path for the Secrets page's plain-API-key form (see Secrets.tsx and
 * sbxCli.secretSetFromPasswordManager). Deliberately minimal: this app never attempts to drive
 * an interactive sign-in or vault-unlock flow for either CLI (that's meaningfully different per
 * tool — `op signin`, `op` desktop-app biometric unlock, `bw login`, `bw unlock` needing a
 * `BW_SESSION` env var this GUI process won't inherit unless the user's shell exported it before
 * launching the app) — if a manager isn't signed in/unlocked, the fetch just fails with that
 * CLI's own real error text, same posture as every other external-tool integration in this app.
 * Not yet tested against real `op`/`bw` installs (see the password-manager backlog entry in the
 * README) — implemented against each CLI's documented command shapes:
 *   - `op read <reference>` (reference like `op://Vault/Item/field`) prints the raw value to stdout.
 *   - `bw get password <name-or-id>` prints the raw value to stdout; `bw status` returns JSON
 *     with a `status` field of `unauthenticated` | `locked` | `unlocked`.
 */

const MANAGERS: Array<{ id: PasswordManagerId; label: string; binary: string }> = [
  { id: 'op', label: '1Password CLI', binary: 'op' },
  { id: 'bw', label: 'Bitwarden CLI', binary: 'bw' }
]

async function binaryExists(binary: string): Promise<boolean> {
  try {
    await execFileAsync(binary, ['--version'], { timeout: 5_000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

async function checkOpStatus(): Promise<{ signedIn: boolean; detail: string | null }> {
  try {
    await execFileAsync('op', ['whoami'], { timeout: 5_000, windowsHide: true })
    return { signedIn: true, detail: null }
  } catch {
    return { signedIn: false, detail: 'Not signed in — run `op signin` in a terminal first.' }
  }
}

async function checkBwStatus(): Promise<{ signedIn: boolean; detail: string | null }> {
  try {
    const { stdout } = await execFileAsync('bw', ['status'], { timeout: 5_000, windowsHide: true })
    const parsed = JSON.parse(stdout) as { status?: string }
    if (parsed.status === 'unlocked') return { signedIn: true, detail: null }
    if (parsed.status === 'locked') {
      return { signedIn: false, detail: 'Vault is locked — run `bw unlock` in a terminal first.' }
    }
    return { signedIn: false, detail: 'Not logged in — run `bw login` in a terminal first.' }
  } catch {
    return { signedIn: false, detail: 'Could not read vault status.' }
  }
}

export async function listPasswordManagers(): Promise<PasswordManagerInfo[]> {
  const results: PasswordManagerInfo[] = []
  for (const m of MANAGERS) {
    const available = await binaryExists(m.binary)
    if (!available) {
      results.push({ id: m.id, label: m.label, available: false, signedIn: null, detail: null })
      continue
    }
    const status = m.id === 'op' ? await checkOpStatus() : await checkBwStatus()
    results.push({ id: m.id, label: m.label, available: true, signedIn: status.signedIn, detail: status.detail })
  }
  return results
}

/**
 * Fetches the raw secret value and returns it to the caller (sbxCli.secretSetFromPasswordManager)
 * inside the main process only — the caller pipes it straight into the existing stdin-based
 * `secret set` plumbing without it ever crossing back over IPC to the renderer.
 */
export async function resolvePasswordManagerSecret(
  managerId: PasswordManagerId,
  reference: string
): Promise<string> {
  const trimmedRef = reference.trim()
  if (!trimmedRef) throw new Error('Secret reference is empty.')

  const { stdout } =
    managerId === 'op'
      ? await execFileAsync('op', ['read', trimmedRef], { timeout: 15_000, windowsHide: true })
      : await execFileAsync('bw', ['get', 'password', trimmedRef], { timeout: 15_000, windowsHide: true })

  const value = stdout.trim()
  if (!value) {
    const label = managerId === 'op' ? '1Password' : 'Bitwarden'
    throw new Error(`${label} returned an empty value for "${trimmedRef}".`)
  }
  return value
}
