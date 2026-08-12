import * as pty from 'node-pty'
import { shell } from 'electron'
import { resolveSbxBinaryPath } from '../sbx/binaryPath'
import { stripAnsi } from './ansi'
import type { PtyLoginResult } from '@shared/types'

// Ground-truth flow confirmed live against sbx v0.38.0 / Claude Code 2.1.228 via a real
// node-pty session (`sbx exec -it <sandbox> claude`):
//   1. The TUI renders a prompt ("❯") once ready for input.
//   2. Sending "/login\r" shows a "Select login method:" menu (subscription / Console API
//      key / 3rd-party). Sending "1\r" picks "Claude account with subscription".
//   3. It prints "Opening browser to sign in…" followed by a plain OAuth URL as a fallback
//      ("Browser didn't open? Use the url below to sign in").
//   4. On completion it prints "Login successful." — confirmed to actually complete via the
//      system's default browser with no further input needed once the URL is opened.
// `/login` is NOT available over the headless `-p` stream-json protocol (confirmed separately)
// — this pty-based flow is the only working path for Anthropic OAuth inside a sandbox.

export function loginClaudeViaPty(
  sandboxName: string,
  opts: { onUrl?: (url: string) => void; timeoutMs?: number } = {}
): Promise<PtyLoginResult> {
  return new Promise((resolve) => {
    let settled = false
    let term: pty.IPty | null = null
    let buffer = ''
    let sentLogin = false
    let sentSelection = false
    let urlOpened = false

    const timeout = setTimeout(
      () => finish({ success: false, message: 'Timed out waiting for sign-in.' }),
      opts.timeoutMs ?? 3 * 60_000
    )

    function finish(result: PtyLoginResult): void {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try {
        term?.kill()
      } catch {
        // already exited
      }
      resolve(result)
    }

    resolveSbxBinaryPath('sbx')
      .then((binPath) => {
        term = pty.spawn(binPath, ['exec', '-it', sandboxName, 'claude'], {
          name: 'xterm-color',
          cols: 120,
          rows: 30,
          cwd: process.cwd(),
          env: process.env as Record<string, string>
        })

        term.onData((raw) => {
          buffer += stripAnsi(raw)

          if (!sentLogin && /❯/.test(buffer)) {
            sentLogin = true
            term!.write('/login\r')
          }

          if (sentLogin && !sentSelection && /select login method/i.test(buffer)) {
            sentSelection = true
            term!.write('1\r') // "Claude account with subscription"
          }

          if (!urlOpened) {
            const match = raw.match(/https?:\/\/[^\s\x1b\x07]+/)
            if (match) {
              urlOpened = true
              opts.onUrl?.(match[0])
              void shell.openExternal(match[0])
            }
          }

          if (/login successful/i.test(buffer)) {
            finish({ success: true, message: 'Signed in to Claude.' })
          } else if (/already logged in/i.test(buffer)) {
            finish({ success: true, message: 'Already signed in.' })
          }
        })

        term.onExit(({ exitCode }) => {
          if (!settled) {
            finish({
              success: false,
              message: exitCode === 0 ? 'Session ended before sign-in completed.' : `Session exited (code ${exitCode}).`
            })
          }
        })
      })
      .catch((err: Error) => finish({ success: false, message: err.message }))
  })
}
