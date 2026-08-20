import { spawn, ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { createInterface } from 'readline'
import type { AgentSessionAdapter } from './AgentSessionAdapter'
import type { AgentSessionEvent } from '@shared/types'

// Ground-truth wire protocol confirmed live against sbx v0.38.0 / Codex CLI v0.146.0:
//   sbx exec <sandbox> codex exec --json --skip-git-repo-check -c approval_policy="never" [resume <thread_id>] "<prompt>"
// - `codex exec` is one-shot per invocation (unlike Claude's persistent stdin-reading process) —
//   every message spawns a fresh process, unlike ClaudeStreamJsonAdapter's single long-lived one.
//   Continuation across turns uses `codex exec resume <thread_id>`.
// - Confirmed live: under the default approval policy, a command needing escalation just hangs
//   forever waiting for a TTY approval prompt that can never come headlessly (had to kill it).
//   `-c approval_policy="never"` (a config override) avoids the hang — failed executions are
//   just returned to the model instead. Note `-a`/`--ask-for-approval` exists only on the
//   top-level `codex` command, NOT on `codex exec` (confirmed live: `-a` errors as an
//   "unexpected argument" there), so the config-override form is the only way in on this path.
// - Real events, confirmed live end to end: {"type":"thread.started","thread_id":...},
//   {"type":"turn.started"}, {"type":"item.started"/"item.completed","item":{"type":
//   "command_execution"|"agent_message"|"error",...}}, {"type":"turn.completed","usage":{...}},
//   {"type":"turn.failed","error":{"message":...}}. Top-level {"type":"error",...} events are
//   typically transient reconnect noise during retries, not fatal on their own.
// - No `-i` on the outer `sbx exec` — this is a one-shot argv-driven command, not a persistent
//   stdin-reading process, so there's nothing to keep stdin open for.

interface CodexItem {
  id?: string
  type?: string
  text?: string
  command?: string
  aggregated_output?: string
  exit_code?: number | null
  message?: string
}

interface CodexEvent {
  type: string
  thread_id?: string
  item?: CodexItem
  error?: { message?: string }
}

export class CodexExecAdapter implements AgentSessionAdapter {
  readonly agent = 'codex'
  private handlers: Array<(e: AgentSessionEvent) => void> = []
  private threadId: string | null = null
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null
  private started = false

  constructor(private readonly sandboxName: string) {}

  private emit(event: AgentSessionEvent): void {
    for (const h of this.handlers) h(event)
  }

  onEvent(handler: (e: AgentSessionEvent) => void): () => void {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }

  isRunning(): boolean {
    return this.child !== null
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    // No persistent process — codex exec is one-shot per message — so "ready" just means
    // the session object exists and is willing to accept a first message.
    this.emit({ type: 'status', status: 'ready' })
  }

  async sendMessage(text: string): Promise<void> {
    const codexArgs = ['exec', '--json', '--skip-git-repo-check', '-c', 'approval_policy="never"']
    if (this.threadId) codexArgs.push('resume', this.threadId)
    codexArgs.push(text)

    return new Promise((resolve) => {
      const child = spawn('sbx', ['exec', this.sandboxName, 'codex', ...codexArgs], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      this.child = child

      let stderrTail = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000)
      })

      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => this.handleLine(line))

      child.on('error', (err) => {
        this.child = null
        this.emit({ type: 'error', message: err.message })
        resolve()
      })

      child.on('exit', (code) => {
        this.child = null
        if (code !== 0 && code !== null) {
          const detail = stderrTail.trim()
          if (detail) this.emit({ type: 'error', message: detail })
        }
        resolve()
      })
    })
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let evt: CodexEvent
    try {
      evt = JSON.parse(trimmed) as CodexEvent
    } catch {
      // Non-JSON noise (e.g. "Reading additional input from stdin...") — ignore.
      return
    }

    if (evt.type === 'thread.started') {
      this.threadId = evt.thread_id ?? this.threadId
      return
    }

    if (evt.type === 'item.started' && evt.item?.type === 'command_execution') {
      this.emit({
        type: 'tool_use',
        id: evt.item.id ?? crypto.randomUUID(),
        name: 'command_execution',
        input: { command: evt.item.command }
      })
      return
    }

    if (evt.type === 'item.completed' && evt.item?.type === 'command_execution') {
      this.emit({
        type: 'tool_result',
        toolUseId: evt.item.id ?? '',
        content: evt.item.aggregated_output ?? '',
        isError: (evt.item.exit_code ?? 0) !== 0
      })
      return
    }

    if (evt.type === 'item.completed' && evt.item?.type === 'agent_message') {
      this.emit({
        type: 'assistant_message',
        text: evt.item.text ?? '',
        messageId: evt.item.id ?? crypto.randomUUID()
      })
      return
    }

    if (evt.type === 'item.completed' && evt.item?.type === 'error') {
      this.emit({ type: 'error', message: evt.item.message ?? 'Unknown error' })
      return
    }

    if (evt.type === 'turn.failed') {
      this.emit({ type: 'error', message: evt.error?.message ?? 'Turn failed' })
      return
    }

    // Top-level "error" events are transient reconnect noise during retries — the terminal
    // "turn.failed" (handled above) is what actually matters. "turn.started"/"turn.completed"
    // carry no additional UI-relevant state.
  }

  async stop(): Promise<void> {
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        // already exited
      }
      this.child = null
    }
  }

  // One-shot per message already, so "interrupt the current turn" and "stop" are the same
  // operation here: kill whatever's in-flight. threadId is untouched, so the next sendMessage()
  // still resumes the same thread — nothing extra to restart.
  async interrupt(): Promise<void> {
    await this.stop()
  }
}
