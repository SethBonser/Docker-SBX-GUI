import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { resolveSbxBinaryPath } from '../sbx/binaryPath'

interface TerminalDataPayload {
  sandboxName: string
  data: string
}

// `sbx run --name <sandbox>` re-attaches interactively and reads the agent from the
// sandbox's own spec — confirmed live to work identically for any agent type (claude,
// codex, shell, ...), auto-starting a stopped sandbox the same way `sbx exec` does. This
// is the one place in the app that gives genuine terminal interactivity (slash-command
// pickers, autocomplete, permission prompts) since it's real terminal rendering, not a
// parsed/reconstructed chat view.
class TerminalSessionManagerImpl {
  private sessions = new Map<string, pty.IPty>()

  private broadcast(sandboxName: string, data: string): void {
    const payload: TerminalDataPayload = { sandboxName, data }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.terminalData, payload)
    }
  }

  async ensureStarted(sandboxName: string): Promise<void> {
    if (this.sessions.has(sandboxName)) return

    const binPath = await resolveSbxBinaryPath('sbx')
    const term = pty.spawn(binPath, ['run', '--name', sandboxName], {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: process.env as Record<string, string>
    })
    this.sessions.set(sandboxName, term)

    term.onData((data) => this.broadcast(sandboxName, data))
    term.onExit(({ exitCode }) => {
      this.sessions.delete(sandboxName)
      // The only channel TerminalView listens to is the raw data stream, so a visible message
      // here (instead of silently deleting the session with no signal at all) is what makes a
      // failed/ended session show *something* instead of just going permanently blank.
      this.broadcast(
        sandboxName,
        `\r\n\x1b[33m[session ended, exit code ${exitCode}]\x1b[0m\r\n`
      )
    })
  }

  write(sandboxName: string, data: string): void {
    this.sessions.get(sandboxName)?.write(data)
  }

  resize(sandboxName: string, cols: number, rows: number): void {
    if (cols <= 0 || rows <= 0) return
    try {
      this.sessions.get(sandboxName)?.resize(cols, rows)
    } catch {
      // pty may have just exited between the check above and the resize call — harmless.
    }
  }

  stop(sandboxName: string): void {
    const term = this.sessions.get(sandboxName)
    if (!term) return
    try {
      term.kill()
    } catch {
      // already exited
    }
    this.sessions.delete(sandboxName)
  }
}

export const terminalSessionManager = new TerminalSessionManagerImpl()
