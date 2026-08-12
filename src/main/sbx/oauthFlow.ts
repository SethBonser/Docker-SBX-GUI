import { spawn } from 'child_process'
import { shell } from 'electron'
import { createInterface } from 'readline'

const URL_PATTERN = /https?:\/\/\S+/

/**
 * Runs an sbx command that performs a browser-based OAuth login (e.g. `sbx login`,
 * `sbx secret set openai --oauth`), watches its output for the URL it prints, opens that
 * URL in the system browser, and resolves once the process exits successfully.
 *
 * Confirmed live against sbx v0.38.0: `sbx secret set openai --oauth` prints
 * "Open this URL to sign in ...\n<url>" to stdout and then blocks until the local
 * OAuth callback completes. `sbx login`'s interactive flow follows the same
 * device/browser-URL pattern Docker's own CLI tooling uses elsewhere.
 */
export function runOAuthFlow(
  args: string[],
  opts: { onUrl?: (url: string) => void; timeoutMs?: number } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('sbx', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

    let settled = false
    const timeout = setTimeout(
      () => {
        if (settled) return
        settled = true
        child.kill()
        reject(new Error('Timed out waiting for sign-in to complete.'))
      },
      opts.timeoutMs ?? 5 * 60_000
    )

    let urlOpened = false
    const handleChunk = (text: string): void => {
      if (urlOpened) return
      const match = text.match(URL_PATTERN)
      if (match) {
        urlOpened = true
        opts.onUrl?.(match[0])
        void shell.openExternal(match[0])
      }
    }

    createInterface({ input: child.stdout }).on('line', handleChunk)
    createInterface({ input: child.stderr }).on('line', handleChunk)

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(err)
    })

    child.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (code === 0) resolve()
      else reject(new Error(`Sign-in did not complete (exit code ${code}).`))
    })
  })
}
