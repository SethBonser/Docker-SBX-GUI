# Docker Sandbox GUI

A desktop GUI for [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) — create, manage, and chat with AI coding agent sandboxes without ever touching a terminal.

Docker Sandboxes (the `sbx` CLI) runs AI coding agents like Claude Code in isolated microVMs, each with its own Docker daemon, filesystem, and network policy. This app wraps that CLI in a native Windows desktop app so the whole workflow — creating sandboxes, applying kits, publishing ports, and having the actual agent conversation — happens in a GUI window instead of a shell.

Status: early, actively developed. Windows-first; a macOS build is scaffolded but unsigned/untested (no Mac available to build on).

## How it's built

**Stack:** Electron + React + TypeScript, scaffolded with [electron-vite](https://electron-vite.org/), styled with Tailwind CSS, packaged with [electron-builder](https://www.electron.build/).

**Why Electron:** `sbx` has no REST API — it's CLI-only, with a handful of commands (`ls`, `ports`, `kit inspect`) supporting `--json` output and everything else needing defensive text parsing. Electron gives a single codebase that can shell out to a native CLI, spawn a real pseudo-terminal for the pieces that genuinely need one, and still ship a normal-looking desktop app.

**Process architecture** (standard Electron three-process split):
- `src/main/` — the only process that touches the filesystem, spawns processes, or talks to `sbx`. Everything CLI-related lives under `src/main/sbx/` (the command wrapper, JSON/text parsers, error classification, health probing); everything chat-related lives under `src/main/agents/`.
- `src/preload/` — a narrow bridge (`contextBridge.exposeInMainWorld`) exposing a typed `window.sbxApi` surface to the renderer. The renderer never touches Node or Electron APIs directly.
- `src/renderer/` — the React UI (routes, components, React Query for server state, Zustand for the live chat event stream).
- `src/shared/` — the IPC channel names and TypeScript types both sides agree on, so main/preload/renderer can't silently drift apart.

**The chat panel** is the least obvious part. `sbx exec -i <sandbox> claude -p --output-format stream-json --input-format stream-json` runs Claude Code headlessly and emits newline-delimited JSON events — this is the same protocol the official Claude Agent SDK is built on, and it's confirmed (by testing against a live sandbox) not to allocate a pseudo-terminal, so stdout stays a clean parseable pipe. That protocol has real limits, both confirmed live rather than assumed:

- Claude's `/login` OAuth flow refuses to run without a real TTY. For that one case, the app spawns a genuine pty via [`node-pty`](https://github.com/microsoft/node-pty), drives the interactive login menu programmatically, scrapes the OAuth URL out of the terminal output, and opens it in the system browser. This runs both during first sign-in and as the "Sign in to Claude" banner that appears mid-chat if a session turns out to be unauthenticated.
- Risky Bash commands (process substitution, complex chaining) get an **immediate, automatic, final denial** — `{"type":"system","subtype":"permission_denied",...}` — with no bidirectional "ask and wait" channel to respond to. There is no way to build an in-chat approve/deny button for a *specific* blocked command; the only real lever is the session-level `--permission-mode` flag it's launched with. All 6 of the CLI's modes were tested live (see `ClaudePermissionMode` in `src/shared/types.ts` for the full findings) — `default`, `acceptEdits` (edits only, doesn't help Bash), `auto` (gets past blocks but reasons around them, ~3x slower), `dontAsk` (*more* restrictive, not less), `bypassPermissions` (unblocks everything), and `plan` (gets permanently stuck planning — the tool needed to exit plan mode isn't available headlessly). `manual` is excluded — same TTY constraint as `/login`. The chat panel exposes a live per-session picker plus a saved default (see Settings below).
- Its own `system/init` event — originally used as the "ready" signal — doesn't print until *after* the first message is sent, so it can never fire on its own. The real readiness signal is the child process's own `spawn` event instead (fires in ~15ms, no input required).
- Its TUI renders justified text using cursor-forward escape codes (`\x1b[1C`) instead of literal spaces between words — anything matching multi-word phrases in stripped terminal output needs `\s*` between tokens, not a literal space, or the match silently never fires. (This bit the `/login` menu-detection logic once already.)

**The Terminal tab** sits alongside the chat panel on every sandbox (`xterm.js` + `node-pty`, `sbx run --name <sandbox>` — confirmed to re-attach interactively for *any* agent type, reading the agent from the sandbox's own spec, and auto-starting it if stopped). It's genuine terminal rendering, not parsed-and-reconstructed chat bubbles, so anything the headless protocol structurally can't do — `/mcp`-style interactive pickers, autocomplete, real per-command approval prompts — works normally here. Both tabs stay mounted for the lifetime of the sandbox detail page (switching is a CSS visibility toggle, not an unmount) so neither the conversation nor the terminal's scrollback is lost switching back and forth; the terminal's scrollback is additionally mirrored into a renderer-side store (capped at 300k chars) so it survives navigating away from the sandbox and back, the same way the chat store already did.

**How each feature was scoped:** the CLI's actual behavior was verified against a live `sbx` install throughout — real JSON output shapes, real error text, real flag requirements (e.g. `sbx rm` and `sbx logout` need `-f`/`-y` or they hang forever waiting for a TTY confirmation prompt that will never come) — rather than working from documentation assumptions alone.

**A frontend gotcha worth knowing before touching `ChatPanel.tsx`:** its mount effect is deliberately split in two — one effect that only subscribes/unsubscribes to chat events, and a separate one (guarded by a `useRef`, not a dependency) that starts the actual session exactly once. They used to be combined, gated behind the same ref. That broke under React `StrictMode`'s dev-mode double-invoke (mount → cleanup → mount again on the same instance): the ref survived the double-invoke, so the second pass's early-return skipped resubscribing after the first pass's cleanup had already torn the listener down — leaving a chat session genuinely running in the main process with a renderer permanently deaf to it (stuck on "Not started" forever, while the Terminal tab for the same sandbox worked fine). Only reproduces in `npm run dev`, never in a packaged production build, since production React strips `StrictMode`'s double-invoke behavior. If a status/event stream ever seems to "start" only after some unrelated action (like sending a message adds a local optimistic bubble that looks like progress), suspect this same class of bug: a subscription's cleanup and re-subscription have gotten out of sync with a one-shot "start" guard.

## Security measures

This app runs a real CLI with real credentials on your machine, so it was built with a few deliberate constraints:

**Renderer isolation.** `contextIsolation: true`, `nodeIntegration: false`, and a `Content-Security-Policy` meta tag restricting script/style origins to the app itself. The renderer has zero direct access to Node.js, `child_process`, or the filesystem — every privileged action goes through a specific, typed IPC handler in `src/preload/index.ts`, not a generic passthrough.

**No shell interpretation.** Every `sbx` invocation is spawned with an argument array (`execFile`/`spawn`), never a shell string. Workspace paths, sandbox names, and kit references can't be interpreted as shell syntax, which closes off command-injection from anything derived from user input (a sandbox name, a folder path, a kit reference).

**External links are restricted.** The one IPC channel that opens URLs (`shell:openExternal`) rejects anything that isn't `https://` before handing it to the OS.

**Dependency supply-chain hygiene.** Every dependency in `package.json` is exact-pinned (no `^`/`~` ranges), and the full resolved dependency tree was checked against two things before anything was installed:
- No package published within 3 days of being added — a deliberate guard against a maintainer-account compromise landing in a "latest" install before the community has flagged it. A handful of fast-moving transitive dependencies (`browserslist`, `esbuild`, etc.) are pinned via `overrides` to the newest version that clears that bar.
- No trace of the packages hit by the real September–November 2025 npm supply-chain compromises (`keyv`, `cacheable`, `cacheable-request`, `flat-cache`, `file-entry-cache`, `cache-manager`), checked by name across the entire resolved tree, not just direct dependencies.

`npm audit` findings were also fixed rather than ignored where a non-breaking fix existed (Electron, electron-builder, and Vite were all bumped off vulnerable majors during development).

**Reproducible native-module fix.** `node-pty` needed a one-line fix to a vendored build script to work on this machine; that fix is captured as a `patch-package` patch (`patches/node-pty+1.1.0.patch`) instead of a silent hand-edit to `node_modules`, so it's version-controlled, reviewable, and reapplied automatically on every install.

**No secrets in source.** Credentials (Anthropic API keys, GitHub tokens, etc.) are handled by `sbx`'s own OS-keychain-backed secret store, never written to disk or logged by this app.

## How to use it

### Prerequisites

- Windows 11 (x64), with Hypervisor Platform enabled
- [Docker Sandboxes (`sbx`)](https://docs.docker.com/ai/sandboxes/get-started/) installed — `winget install -h Docker.sbx` — and signed in (`sbx login`)
- Node.js 22+ (only needed to build/run from source — not required once you have a packaged installer)

### Running from source

```bash
npm install      # also builds node-pty's native module — see note below
npm run dev       # launches the app with hot reload
```

> **First install only:** `node-pty` compiles a native module and needs the Visual Studio Build Tools ("Desktop development with C++" workload, including the Spectre-mitigated libraries individual component) plus Python. If `npm install` fails on `node-pty`, that's almost always the missing piece — install the Build Tools and re-run `npm install`.

### Building an installer

**Windows:**

```bash
npm run build:win
```

Produces `release/Docker Sandbox GUI-<version>-setup.exe` (and a `.msi`). It's currently unsigned, so Windows SmartScreen will flag it on first run — **More info → Run anyway**.

**macOS** (must be run *on* a Mac — see [Running on macOS](#running-on-macos) below for why):

```bash
npm install       # needs Xcode Command Line Tools for node-pty — xcode-select --install
npm run build:mac
```

Produces `release/Docker Sandbox GUI-<version>-arm64.dmg` (Apple Silicon only, matching `sbx`'s own requirement). It's unsigned and unnotarized, so Gatekeeper will block it on first launch — right-click the app → **Open**, or `xattr -cr "/Applications/Docker Sandbox GUI.app"` from Terminal.

### Using the app

1. **Sign in.** The circular badge in the top-right shows your Docker account. If you're not signed in, click it and choose **Sign in to Docker** — this opens your browser for the real `sbx login` OAuth flow.
2. **Create a sandbox.** Click **New sandbox** on the Dashboard and walk through the wizard: pick an agent, choose a workspace folder, set a name and (optionally) resource limits, attach any **Kits** you want (previewed live before you commit — shows exactly what credentials, network rules, and setup steps a kit will apply), optionally publish ports or add network deny rules, then review and create.
3. **Run it.** Sandboxes you create start automatically; a stopped sandbox shows a **Run** button on its card.
4. **Chat or Terminal.** Click into a sandbox to open its detail page — **Chat** and **Terminal** are tabs at the top, and switching between them never loses anything (both stay live). Chat is the polished default: markdown, copyable code blocks, tool-use indicators, and a **Permissions** dropdown (top-right of the chat header) if a command gets blocked — pick Auto or Bypass for that session, or switch to Terminal for a real interactive prompt instead. If the sandbox isn't signed in to Claude yet, a **Sign in to Claude** banner appears and drives the real OAuth flow for you.
5. **Settings.** The same account badge's dropdown also has your defaults — which tab (Chat/Terminal) new sandboxes open to, and which permission mode new chat sessions start with.
6. **Stop / Remove** from the sandbox card when you're done — Remove is permanent and asks for confirmation first.

Non-Claude agents (Codex, Gemini, etc.) can be created and run, and the Terminal tab works for them today (it's agent-agnostic) — they just don't have a *structured chat* adapter yet (the Chat tab will say so). That's tracked as upcoming work, along with Ports/Policy management from the sandbox detail view, a Secrets manager, and first-run onboarding.

### Running on macOS

The application code is already cross-platform — there's nothing Windows-specific in the source (binary path resolution already branches between `where`/`which`, no hardcoded paths or shell quoting that differs by OS). What's *not* possible from this Windows machine is producing a `.dmg`: `electron-builder` can't cross-build a macOS target from Windows, since `.app` bundling and code signing require Apple's own toolchain. A Mac tester needs to clone the repo and build from source themselves, on their Mac, using the `npm run build:mac` steps above (or `npm run dev` for a quicker look) — they'll also need [Docker Sandboxes for Mac](https://docs.docker.com/ai/sandboxes/get-started/) (`brew install docker/tap/sbx`, then `sbx login`), which requires macOS Sonoma+ on Apple Silicon.

If anything behaves differently from the Windows build, that's genuinely useful signal — the only real testing this app has had so far is on Windows.

## Planned / upcoming work

For an agent picking this project back up: the app is built incrementally, each piece built and verified live against a real `sbx` install before moving on (not from documentation assumptions alone — the CLI's actual JSON shapes, error text, and flag requirements were all confirmed by testing, including things that turned out to *not* work as assumed — see the gotchas above). Done so far: scaffold + packaging, the Dashboard, the Create-sandbox wizard with Kits, the Claude chat panel with a live permission-mode picker, the embedded Terminal tab, and the Docker/Anthropic sign-in flows and Settings menu described above.

**Next up:**
- **Structured chat adapter for non-Claude agents** (Codex, Gemini, Copilot, etc.) — the Terminal tab already gives them a working *interactive* session today (it's agent-agnostic), so this is specifically about parsing a non-Claude agent's own headless/structured output mode (if one exists) into the same chat-bubble UI Claude gets. Lower urgency now that Terminal covers the "can I use it at all" gap.
- **Ports and Policy tabs** on the sandbox detail page (`sbx ports`, `sbx policy` are wrapped nowhere in the UI yet).
- **Secrets manager** — a guided per-service credential screen. Ground truth already gathered: `sbx secret set <service> --oauth` is a real, working browser-redirect flow but *only* for `openai`; every other service (including `anthropic`) needs either a plain API key piped to `sbx secret set <service>` via stdin, or — for Anthropic specifically — the same `node-pty`-driven `/login` flow already built for the chat panel's sign-in banner.
- **Onboarding** — first-run detection of whether `sbx` is installed at all, a guided `winget install -h Docker.sbx` flow, and the default network-policy tier picker. Right now the app assumes `sbx` is already installed.
- **A real Settings screen** — daemon status, `sbx diagnose` output viewer, sbx version/update check. Note this is distinct from what already exists: login/logout and the default-view/default-permission-mode toggles already live in the `UserBadge` dropdown, not a dedicated Settings page — a real screen is still backlog.

**Already resolved (was previously listed here as deferred):**
- **In-chat interactive menus** (`/mcp`, autocomplete, other slash-command pickers) *for the Chat tab specifically* remain structurally impossible — they're rendered by Claude Code's own terminal UI layer with no representation in the headless JSON protocol. But the originally-considered alternative — embedding a real terminal emulator as a second view alongside chat — **is now built**: the Terminal tab (`xterm.js` + `node-pty`, see above). Anything needing real interactivity has a home; it just isn't inside the chat bubbles.

**Still deliberately deferred (with reasoning, so it isn't re-litigated from scratch):**
- **MCP server management screen** — a native-GUI way to register/manage MCP servers without needing `/mcp` in chat.
- **Kit authoring** (`sbx kit pack`/`push`) — the app only *uses* kits (inspect/validate/apply), doesn't build them.
- `sbx skills` UI, `sbx cp` (file transfer) UI.
- **macOS code signing and notarization** — needs an Apple Developer identity and an actual Mac; the `.dmg` build is otherwise ready to go (see above).
- **Auto-update.**
