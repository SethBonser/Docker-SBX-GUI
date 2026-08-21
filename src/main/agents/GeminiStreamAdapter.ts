import { spawn, ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { createInterface } from 'readline'
import type { AgentSessionAdapter } from './AgentSessionAdapter'
import type { AgentSessionEvent } from '@shared/types'

// Ground-truth wire protocol confirmed live against sbx v0.38.0 / Gemini CLI (2026-08):
//   sbx exec <sandbox> gemini -p "<prompt>" -o stream-json --skip-trust --approval-mode yolo [--resume latest]
// - One-shot per invocation, like Codex — not a persistent stdin-reading process.
// - Confirmed live: `--resume` only accepts "latest" or a numeric index, NOT a session UUID —
//   passing the exact UUID printed by the "init" event fails with "No previous sessions found
//   for this project." Since each sandbox only ever runs one conversation at a time in this
//   app, "latest" is unambiguous here.
// - Confirmed live: assistant text streams as multiple {"type":"message","role":"assistant",
//   "content":"...","delta":true} chunks that must be concatenated (e.g. "Endless blue
//   expanse,\nWhispering" + " waves touch the shore,\nDeep, eternal peace." = one haiku) — this
//   is genuine incremental streaming, unlike Codex's one-shot-per-item agent_message. Buffered
//   here and flushed as a single assistant_message on the next non-message event or on exit.
// - Tool calls map directly: {"type":"tool_use","tool_name":...,"tool_id":...,"parameters":...}
//   and {"type":"tool_result","tool_id":...,"status":...,"output":...} — literally the same
//   field names as this app's own AgentSessionEvent union.
// - Under the default approval mode, an unapproved tool call would hang the same way Codex's
//   did (never empirically re-confirmed after finding Codex's version of this, but the failure
//   mode is universal enough across these headless agentic CLIs not to risk it) — `--approval-mode
//   yolo` auto-approves everything so there's nothing to hang on.

interface GeminiEvent {
  type: string
  role?: string
  content?: string
  delta?: boolean
  tool_name?: string
  tool_id?: string
  parameters?: unknown
  status?: string
  output?: string
  error?: { message?: string } | string
}

export class GeminiStreamAdapter implements AgentSessionAdapter {
  readonly agent = 'gemini'
  private handlers: Array<(e: AgentSessionEvent) => void> = []
  private hasSentFirstMessage = false
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null
  private started = false
  private assistantBuffer = ''
  private assistantMessageId: string | null = null

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
    this.emit({ type: 'status', status: 'ready' })
  }

  private flushAssistantBuffer(): void {
    if (!this.assistantBuffer) return
    this.emit({
      type: 'assistant_message',
      text: this.assistantBuffer,
      messageId: this.assistantMessageId ?? crypto.randomUUID()
    })
    this.assistantBuffer = ''
    this.assistantMessageId = null
  }

  async sendMessage(text: string): Promise<void> {
    const args = ['-p', text, '-o', 'stream-json', '--skip-trust', '--approval-mode', 'yolo']
    if (this.hasSentFirstMessage) args.push('--resume', 'latest')
    this.hasSentFirstMessage = true

    return new Promise((resolve) => {
      const child = spawn('sbx', ['exec', this.sandboxName, 'gemini', ...args], {
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
        this.flushAssistantBuffer()
        this.emit({ type: 'error', message: err.message })
        resolve()
      })

      child.on('exit', (code) => {
        this.child = null
        this.flushAssistantBuffer()
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

    let evt: GeminiEvent
    try {
      evt = JSON.parse(trimmed) as GeminiEvent
    } catch {
      // Non-JSON noise (color-support warnings, "YOLO mode is enabled", etc.) — ignore.
      return
    }

    if (evt.type === 'message' && evt.role === 'assistant') {
      this.assistantBuffer += evt.content ?? ''
      return
    }

    // Any other event ends whatever assistant text was streaming.
    this.flushAssistantBuffer()

    if (evt.type === 'message' && evt.role === 'user') {
      // Echo of our own prompt — not new information.
      return
    }

    if (evt.type === 'tool_use') {
      this.emit({
        type: 'tool_use',
        id: evt.tool_id ?? crypto.randomUUID(),
        name: evt.tool_name ?? 'unknown_tool',
        input: evt.parameters
      })
      return
    }

    if (evt.type === 'tool_result') {
      this.emit({
        type: 'tool_result',
        toolUseId: evt.tool_id ?? '',
        content: evt.output ?? '',
        isError: evt.status !== 'success'
      })
      return
    }

    if (evt.type === 'result' && evt.status === 'error') {
      const message = typeof evt.error === 'string' ? evt.error : evt.error?.message
      this.emit({ type: 'error', message: message ?? 'Gemini reported an error' })
      return
    }

    // "init" (session bookkeeping) and a successful "result" carry no additional UI-relevant state.
  }

  // Waits for the kill to actually take effect before resolving (bounded by a timeout) rather
  // than assuming it's instant — a caller that immediately spawns a replacement session for the
  // same sandbox (Clear chat) could otherwise race a still-alive process from this one. See the
  // matching comment on ClaudeStreamJsonAdapter.stop() for the full reasoning (found there
  // first, from a live report of Chat hanging for up to a minute after Clear chat).
  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    if (!child || child.exitCode !== null) return

    await new Promise<void>((resolve) => {
      const giveUp = setTimeout(resolve, 5_000)
      child.once('exit', () => {
        clearTimeout(giveUp)
        resolve()
      })
      try {
        child.kill()
      } catch {
        // already exited
      }
    })
  }

  // One-shot per message already, so "interrupt the current turn" and "stop" are the same
  // operation here: kill whatever's in-flight. The next sendMessage() still resumes via
  // `--resume latest`, so nothing extra needs restarting.
  async interrupt(): Promise<void> {
    await this.stop()
  }
}
