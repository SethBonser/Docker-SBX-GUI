import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { createInterface } from 'readline'
import type { AgentSessionAdapter } from './AgentSessionAdapter'
import type { AgentSessionEvent } from '@shared/types'

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
    return this.child !== null && this.child.exitCode === null
  }

  async start(): Promise<void> {
    if (this.child) return

    this.emit({ type: 'status', status: 'connecting' })

    const child = spawn(
      'sbx',
      [
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
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    this.child = child

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => this.handleLine(line))

    child.on('error', (err) => {
      this.emit({ type: 'error', message: err.message })
    })

    child.on('exit', (code) => {
      this.child = null
      if (code !== 0 && code !== null) {
        this.emit({ type: 'error', message: `claude session exited with code ${code}` })
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
      this.sessionId = evt.session_id ?? this.sessionId
      this.emit({ type: 'status', status: 'ready' })
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

    // "result" (turn complete) and other system subtypes carry no additional UI-relevant state for v1.
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
}
