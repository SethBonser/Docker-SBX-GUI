import { spawn, ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import { createInterface } from 'readline'
import type { AgentSessionAdapter } from './AgentSessionAdapter'
import type { AgentSessionEvent } from '@shared/types'

// Ground-truth wire protocol confirmed live against sbx v0.38.0 / docker-agent (cagent):
//   sbx exec <sandbox> docker-agent run --exec --json --yolo coder --session <our-uuid> "<prompt>"
// - One-shot per invocation, like Codex/Gemini. Unlike Gemini's index-based --resume, --session
//   takes an exact ID we choose ourselves and creates-or-resumes it transparently (confirmed
//   live: "An explicit ID that does not exist yet is created with that ID") — the cleanest of
//   the three continuation mechanisms, no special-casing needed for "first message vs resume".
// - "coder" is docker-agent's built-in general-purpose coding agent (confirmed live via
//   `docker-agent run coder ...`) — used as a fixed default rather than requiring a config file.
// - Confirmed live: assistant text streams as multiple {"type":"agent_choice","content":"..."}
//   chunks needing concatenation (e.g. "hello-" + "from-docker-agent"), same shape as Gemini's
//   delta streaming. Buffered and flushed as one assistant_message per run.
// - Tool calls: {"type":"tool_call","tool_call":{"id":...,"function":{"name":...,"arguments":
//   "<json string>"}}} and {"type":"tool_call_response","tool_call_id":...,"response":...}.
//   There's also a "tool_call_output" event carrying the same info in a slightly different
//   shape — only tool_call_response is used here to avoid emitting two tool_result events for
//   one call.
// - Confirmed live: the default "coder" agent needs a genuine Anthropic API key — the OAuth
//   token this app's Secrets page sets up for Claude Code's own subscription login is a
//   different credential shape and doesn't satisfy it (real 401 from Anthropic's API otherwise).
//   No model override is hardcoded here; if the account isn't set up for whatever provider
//   docker-agent's own config resolves to, the raw error surfaces as-is rather than silently
//   forcing a specific provider the user didn't choose.
// - Confirmed live: fatal errors (bad credentials, etc.) print a single plain "Error: ..." line
//   to stderr, not a structured JSON event — the stderr-tail-on-nonzero-exit fallback (same
//   pattern as every other adapter here) is what actually surfaces them, not JSON parsing.

interface DockerAgentToolCall {
  id?: string
  function?: { name?: string; arguments?: string }
}

interface DockerAgentEvent {
  type: string
  content?: string
  tool_call?: DockerAgentToolCall
  tool_call_id?: string
  response?: unknown
  result?: { output?: unknown }
}

export class DockerAgentAdapter implements AgentSessionAdapter {
  readonly agent = 'docker-agent'
  private handlers: Array<(e: AgentSessionEvent) => void> = []
  private readonly sessionId = crypto.randomUUID()
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null
  private started = false
  private assistantBuffer = ''

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
    this.emit({ type: 'assistant_message', text: this.assistantBuffer, messageId: crypto.randomUUID() })
    this.assistantBuffer = ''
  }

  async sendMessage(text: string): Promise<void> {
    const args = ['run', '--exec', '--json', '--yolo', 'coder', '--session', this.sessionId, text]

    return new Promise((resolve) => {
      const child = spawn('sbx', ['exec', this.sandboxName, 'docker-agent', ...args], {
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

    let evt: DockerAgentEvent
    try {
      evt = JSON.parse(trimmed) as DockerAgentEvent
    } catch {
      return
    }

    if (evt.type === 'agent_choice') {
      this.assistantBuffer += evt.content ?? ''
      return
    }

    this.flushAssistantBuffer()

    if (evt.type === 'tool_call' && evt.tool_call) {
      let input: unknown = evt.tool_call.function?.arguments
      try {
        if (typeof input === 'string') input = JSON.parse(input)
      } catch {
        // leave as the raw string if it isn't valid JSON
      }
      this.emit({
        type: 'tool_use',
        id: evt.tool_call.id ?? crypto.randomUUID(),
        name: evt.tool_call.function?.name ?? 'unknown_tool',
        input
      })
      return
    }

    if (evt.type === 'tool_call_response') {
      const content =
        typeof evt.response === 'string'
          ? evt.response
          : typeof evt.result?.output === 'string'
            ? evt.result.output
            : JSON.stringify(evt.response ?? evt.result ?? '')
      this.emit({ type: 'tool_result', toolUseId: evt.tool_call_id ?? '', content })
      return
    }

    // "hook_started"/"hook_finished", "team_info", "mcp_init_started"/"finished",
    // "toolset_info", "user_message" (echo of our own prompt), "agent_info", "message_added",
    // "token_usage", and "stream_stopped" carry no additional UI-relevant state.
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
  // operation here: kill whatever's in-flight. `--session <id>` is untouched, so the next
  // sendMessage() still resumes the same session — nothing extra to restart.
  async interrupt(): Promise<void> {
    await this.stop()
  }
}
