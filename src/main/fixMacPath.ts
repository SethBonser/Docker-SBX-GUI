import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * A packaged macOS app launched from Finder/Dock is started by launchd, not a login shell —
 * so it inherits a minimal PATH (typically just /usr/bin:/bin:/usr/sbin:/sbin) that's missing
 * anything a shell profile adds, most commonly Homebrew's bin directory (/opt/homebrew/bin on
 * Apple Silicon, /usr/local/bin on Intel — the latter is often already covered by macOS's own
 * /etc/paths, the former usually isn't). Every `sbx` invocation in this app depends on PATH to
 * find it — both execFile-based calls (sbxCli.ts, which pass the bare command "sbx") and the
 * pty-based ones (Terminal, Claude's OAuth login, via resolveSbxBinaryPath's `which sbx`) — so a
 * missing Homebrew path here doesn't just break one feature, it can break all of them, with each
 * surfacing a different, not-obviously-PATH-related error (a raw native "posix_spawnp failed."
 * from node-pty for the pty-based ones, since node-pty needs a fully-resolved path and its error
 * doesn't say why resolution failed).
 *
 * Not needed on Windows or when run from source via `npm run dev` — both already inherit a full
 * environment (Windows GUI apps get the full user/system PATH from the registry; `npm run dev`
 * runs inside whatever shell launched it).
 */
export async function fixMacPath(): Promise<void> {
  if (process.platform !== 'darwin') return

  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = await execFileAsync(shell, ['-lc', 'echo -n "$PATH"'], { timeout: 10_000 })
    const shellPath = stdout.trim()
    if (shellPath && shellPath !== process.env.PATH) {
      process.env.PATH = shellPath
    }
  } catch {
    // Best-effort: if the login shell can't be spawned or the command fails for any reason,
    // leave the inherited PATH as-is rather than blocking startup on this.
  }
}
