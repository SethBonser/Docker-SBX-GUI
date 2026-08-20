import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import type { AgentSessionAdapter } from './AgentSessionAdapter'
import type { AgentSessionEvent, ClaudePermissionMode } from '@shared/types'

// Ground-truth wire protocol confirmed live against sbx v0.38.0 / Claude Code 2.1.221:
//   sbx exec -i <sandbox> claude -p --output-format stream-json --input-format stream-json --include-partial-messages
// - No pty is allocated by `-i` (without `-t`), so stdout is a clean line-delimited JSON pipe.
// - The process stays alive across turns; each stdin line is one user turn; session_id is stable
//   across turns within the same process. Only closing stdin (or killing the process) ends it.
// - Confirmed real event shapes: {"type":"system","subtype":"init",...}, {"type":"assistant","message":{...}},
//   {"type":"result",...}. Content-block shapes (text / tool_use) and the "user" role tool_result
//   message follow the standard Anthropic Messages API content-block schema that stream-json is built on.

interface RawContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string | Array<{ type: string; text?: string }>
  is_error?: boolean
}

interface RawStreamEvent {
  type: string
  message?: {
    id?: string
    role?: string
    content?: RawContentBlock[]
  }
  session_id?: string
  subtype?: string
  tool_name?: string
  tool_use_id?: string
  decision_reason?: string
  mcp_servers?: { name: string; status: string }[]
}

function toolResultToString(content: RawContentBlock['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => (b.type === 'text' ? b.text ?? '' : JSON.stringify(b)))
      .join('\n')
  }
  return ''
}

export class ClaudeStreamJsonAdapter implements AgentSessionAdapter {
  readonly agent = 'claude'
  private child: ChildProcessWithoutNullStreams | null = null
  private handlers: Array<(e: AgentSessionEvent) => void> = []
  private sessionId: string | null = null

  constructor(
    private readonly sandboxName: string,
    private readonly permissionMode: ClaudePermissionMode = 'default'
  ) {}

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
    return this.child !== null && this.child.exitCode === null
  }

  async start(): Promise<void> {
    if (this.child) return

    this.emit({ type: 'status', status: 'connecting' })

    const args = [
      'exec',
      '-i',
      this.sandboxName,
      'claude',
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose'
    ]
    // Confirmed live: omitting this flag entirely (rather than passing "default") gives the
    // CLI's normal default behavior — only add it when the user has chosen something else.
    if (this.permissionMode !== 'default') {
      args.push('--permission-mode', this.permissionMode)
    }

    const child = spawn('sbx', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => this.handleLine(line))

    // Captured purely for diagnostics on a non-zero exit — without this, a failure to launch
    // (sandbox mid-stop, daemon hiccup, etc.) surfaces as the useless "exited with code 1"
    // with no indication of why.
    let stderrTail = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000)
    })

    // Confirmed live: the CLI's own "system/init" event (previously used to signal ready)
    // does NOT print until after the *first* stdin message is sent — it can't be used as a
    // connection-readiness signal, since that would mean "ready" never fires until the user
    // has already sent something. The process's own 'spawn' event (fired once the OS process
    // has actually launched, vs. e.g. an ENOENT failure) is the real readiness signal: stdin
    // is safely writable from that point on, whatever is written just buffers until the CLI
    // gets around to reading it.
    child.on('spawn', () => {
      this.emit({ type: 'status', status: 'ready' })
    })

    child.on('error', (err) => {
      this.emit({ type: 'error', message: err.message })
    })

    child.on('exit', (code) => {
      this.child = null
      if (code !== 0 && code !== null) {
        const detail = stderrTail.trim()
        this.emit({
          type: 'error',
          message: detail
            ? `Session exited (code ${code}): ${detail}`
            : `Session exited (code ${code}) with no error output.`
        })
      }
      this.emit({ type: 'status', status: 'exited' })
    })
  }

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let evt: RawStreamEvent
    try {
      evt = JSON.parse(trimmed) as RawStreamEvent
    } catch {
      // Non-JSON noise on stdout (shouldn't normally happen without a pty) — ignore rather than crash the session.
      return
    }

    if (evt.type === 'system' && evt.subtype === 'init') {
      // Status is already 'ready' from the process's own 'spawn' event — this just captures
      // the session id for potential future --resume support.
      this.sessionId = evt.session_id ?? this.sessionId
      if (evt.mcp_servers) {
        this.emit({ type: 'mcp_status', servers: evt.mcp_servers })
      }
      return
    }

    // Confirmed live: this is an immediate, final auto-denial — there is no bidirectional
    // "ask and wait" channel to respond to for this specific tool_use. The corresponding
    // tool_result (handled below) carries the same reason text; this event exists so the UI
    // can render a purpose-built "blocked by sandbox policy" treatment instead of a generic error.
    if (evt.type === 'system' && evt.subtype === 'permission_denied') {
      this.emit({
        type: 'permission_denied',
        toolUseId: evt.tool_use_id ?? '',
        toolName: evt.tool_name ?? 'unknown_tool',
        reason: evt.decision_reason ?? 'Blocked by sandbox policy'
      })
      return
    }

    if (evt.type === 'assistant' && evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === 'text' && block.text) {
          this.emit({
            type: 'assistant_message',
            text: block.text,
            messageId: evt.message.id ?? crypto.randomUUID()
          })
        } else if (block.type === 'tool_use') {
          this.emit({
            type: 'tool_use',
            id: block.id ?? crypto.randomUUID(),
            name: block.name ?? 'unknown_tool',
            input: block.input
          })
        }
      }
      return
    }

    if (evt.type === 'user' && evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === 'tool_result') {
          this.emit({
            type: 'tool_result',
            toolUseId: block.tool_use_id ?? '',
            content: toolResultToString(block.content),
            isError: block.is_error
          })
        }
      }
      return
    }

    if (evt.type === 'result') {
      this.emit({ type: 'turn_end' })
      return
    }

    // Other system subtypes carry no additional UI-relevant state for v1.
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.child) {
      await this.start()
    }
    const line =
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'
    this.child!.stdin.write(line)
  }

  async stop(): Promise<void> {
    if (!this.child) return
    this.child.stdin.end()
    this.child = null
  }

  // Unlike stop()'s graceful stdin-end (fine for an intentional session end, e.g. Clear chat),
  // this forcefully kills the process — the point is stopping generation immediately, not
  // waiting for it to notice EOF whenever it next reads stdin. Doesn't touch `this.child` or
  // emit anything itself; the existing 'exit' handler (registered in start()) already does
  // both once the kill actually takes effect, so there's exactly one place that happens.
  async interrupt(): Promise<void> {
    if (!this.child) return
    try {
      this.child.kill()
    } catch {
      // already exited
    }
  }
}
