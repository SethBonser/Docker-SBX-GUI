# Docker Sandbox GUI

A desktop GUI for [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) — create, manage, and chat with AI coding agent sandboxes without ever touching a terminal.

Docker Sandboxes (the `sbx` CLI) runs AI coding agents like Claude Code in isolated microVMs, each with its own Docker daemon, filesystem, and network policy. This app wraps that CLI in a native Windows desktop app so the whole workflow — creating sandboxes, applying kits, publishing ports, managing MCP connectors, setting network policy, and having the actual agent conversation — happens in a GUI window instead of a shell.

Status: early, actively developed. Windows-first; a macOS build is scaffolded but unsigned/untested — no Mac available to build on locally, though the GitHub Actions release workflow can now build one on a real `macos-latest` runner (see below), not yet exercised for a real release.

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
- Slash commands aren't passed to the model — Claude Code's own harness intercepts them first. A bare `/mcp` message gets a synthesized one-line summary (`"N MCP server(s): X connected, ..."`) instead of the real interactive picker, and confirmed live by testing it directly: `/mcp reconnect <name>`, `/mcp auth <name>`, and every other picker action reply with **`"Reconnect, enable, and disable aren't available in this session."`** — a hard, explicit refusal from Claude Code itself, not a missing feature on this app's side. There is no text you can send that gets an MCP connector authorized from headless chat. `/login` has the identical constraint (see above). Both are handled by **aliasing them client-side** instead of forwarding the literal text: typing `/login` in Chat intercepts it before it reaches the session and redirects straight to the pty-based sign-in flow; typing `/mcp` still goes to the real session (so you get its canned summary) but additionally reveals a status row and, if anything needs authorization, a banner pointing at the Terminal tab, since that's the only place the actual authorization step can run.

**Codex, Gemini, and docker-agent get the same structured chat panel as Claude**, via three more `AgentSessionAdapter` implementations under `src/main/agents/` — each protocol confirmed live against a real sandbox before being encoded, the same discipline as the Claude adapter above. The shared shape: unlike Claude's one long-lived stdin-reading process, all three CLIs are one-shot-per-message (a fresh `sbx exec` spawn for every turn, with a CLI-specific flag to resume the prior turn's context), and each needed its own "don't hang waiting for an approval prompt that can never come headlessly" flag, discovered the same way as Claude's `permission-mode` finding:
- **Codex** (`codex exec --json`, resumed via `codex exec resume <thread_id>`) hangs forever on any command needing escalation approval under its default policy — confirmed live, had to kill the process. Fixed with `-c approval_policy="never"` (a generic config override); the more obvious `-a never`/`--ask-for-approval` flag doesn't work here because it only exists on the top-level `codex` command, not on `codex exec` (confirmed: passing it to `exec` errors as an unrecognized argument). Separately, and not fixable from this app: Codex CLI has so far only run under a ChatGPT-OAuth-signed-in sandbox by reporting "model not supported when using Codex with a ChatGPT account" for every model tried — looks like an account/plan-tier restriction on OpenAI's side rather than a flag issue.
- **Gemini** (`gemini -p <prompt> -o stream-json`, resumed via `--resume latest`) streams assistant text as genuine incremental deltas (`{"role":"assistant","delta":true,...}` chunks that concatenate into one message — confirmed live with a test prompt whose two delta chunks only formed a complete poem once joined), which the adapter buffers and flushes as a single `assistant_message`. Resume only accepts the literal string `"latest"` or a numeric index — passing the exact session UUID the CLI itself prints on `init` was tested and confirmed to fail ("No previous sessions found for this project"), despite that seeming like the obvious thing to pass. `--approval-mode yolo` avoids the same class of hang Codex has.
- **docker-agent / cagent** (`docker-agent run --exec --json --yolo coder --session <id>`) has the cleanest continuation mechanism of the three — `--session` takes an ID we choose ourselves and transparently creates-or-resumes it, no first-message-vs-resume branching needed in the adapter. Also streams assistant text as deltas (`agent_choice` events), same buffering approach as Gemini. One real gotcha confirmed live: fatal errors (bad credentials, etc.) print as a plain `Error: ...` line to **stderr**, not a structured JSON event, so the adapter's stderr-tail-on-nonzero-exit fallback (already used by the Claude adapter for its own edge cases) is what actually surfaces them — parsing stdout as JSON alone would miss them entirely. Also confirmed live: the built-in `coder` agent hardcodes `anthropic/claude-opus-4-8`, which needs a genuine raw Anthropic API key (via Secrets) — the OAuth token this app's own Claude sign-in flow stores is a different credential shape and does not satisfy it (a real 401 `invalid x-api-key` from Anthropic otherwise). The adapter deliberately does **not** hardcode a different model/provider to route around this — that would silently override a choice that belongs to `docker-agent`'s own config, so whatever error comes back is surfaced as-is.

**The Terminal tab** sits alongside the chat panel on every sandbox (`xterm.js` + `node-pty`, `sbx run --name <sandbox>` — confirmed to re-attach interactively for *any* agent type, reading the agent from the sandbox's own spec, and auto-starting it if stopped). It's genuine terminal rendering, not parsed-and-reconstructed chat bubbles, so anything the headless protocol structurally can't do — `/mcp`-style interactive pickers, autocomplete, real per-command approval prompts — works normally here. Both tabs stay mounted for the lifetime of the sandbox detail page (switching is a CSS visibility toggle, not an unmount) so neither the conversation nor the terminal's scrollback is lost switching back and forth; the terminal's scrollback is additionally mirrored into a renderer-side store (capped at 300k chars) so it survives navigating away from the sandbox and back, the same way the chat store already did. A **"Check /mcp"** button in its header sends `/mcp\r` into the live pty for you — the real interactive picker (with each MCP connector's actual connected/needs-auth status and, for connectors that support it, an Authorize/Reconnect action) renders exactly like it would in a real terminal, since it *is* one. Deliberately **not** attempted: parsing that picker's text server-side to reproduce it elsewhere in the GUI. It's a full-screen TUI redraw using absolute cursor positioning and in-place patches (a "connecting…" cell gets overwritten with "connected · N tools" via a separate write at the same coordinates, not a fresh line), so naively stripping ANSI codes and concatenating the output does not reconstruct it reliably — confirmed by trying exactly that and getting mangled text. Real terminal emulation (what `xterm.js` already does) is the only reliable way to render it, so the picker only ever exists inside an actual terminal.

**MCP server management** (`src/renderer/src/routes/Mcp.tsx`) wraps `sbx mcp` (a separate system from Claude Code's own `claude mcp` / claude.ai connectors, though both show up together in the picker above): register a remote-URL or local-stdio server, authorize it, load it into a running sandbox. Registration always passes `--skip_auth` — authorization is a deliberate separate step, not something that fires the moment you register a server. Authorization reuses `runOAuthFlow` (the same helper `sbx login` uses): confirmed live that `sbx mcp auth <name>` prints the identical `"Open this URL to authorize..."` pattern and blocks until the browser flow completes. One real incident from building this: testing the Authorize button against a real Notion registration completed instantly via an already-logged-in browser session, with no confirmation step in between — a genuine OAuth grant, not just a UI test. It was immediately revoked (`sbx mcp auth rm` + `sbx mcp rm`), but it's a sharp edge worth knowing about — authorizing a server here is a real, live action the moment you click it, exactly like it would be from the terminal.

**Global network policy** (`src/renderer/src/routes/GlobalPolicy.tsx`) wraps `sbx policy`: a tier switcher (Open/Balanced/Locked-down, i.e. `allow-all`/`balanced`/`deny-all`) plus a global custom allow/deny rules manager. `sbx policy init` is one-time and errors if a tier is already set; switching tiers later requires `sbx policy reset` first, which is destructive (wipes every rule, restarts the daemon, stops every running sandbox) — confirmed live and gated behind an explicit confirm dialog spelling that out before it runs. `sbx` has no command to ask "which tier is currently active," so the tier cards' green "Selected" indicator is backed by a local setting (`lastAppliedPolicyTier`) written only when a tier is applied *through this app* — it's honestly blank, not wrong, for a tier that was set via the CLI directly or auto-initialized on first sandbox creation.

**Secrets** (`src/renderer/src/routes/Secrets.tsx`) wraps `sbx secret`, one card per known service (`anthropic`, `cursor`, `droid`, `github`, `google`, `groq`, `mistral`, `nebius`, `openai`, `openrouter`, `xai` — confirmed live via `--help`), each showing every scope it's currently configured in (global and/or per-sandbox) and a form to add a plain API key at either scope. Two real wrinkles found by testing every path live rather than assuming symmetry across services:
- Only `openai` accepts `sbx secret set --oauth`. `anthropic` explicitly refuses it — `ERROR: anthropic OAuth cannot be started from \`sbx secret set\`; sign in from inside the Claude sandbox` — so its card instead has a sandbox picker that reuses the *existing* pty-based `loginClaude` flow (the same one behind Chat's "Sign in to Claude" banner). That path is always global; there is no way to scope an Anthropic OAuth login to one sandbox.
- The plain-API-key path reads the secret from **stdin**, not argv (`echo "$KEY" | sbx secret set <service>`) — confirmed live, and matches the CLI's own documented example. `execFile` (used everywhere else in `sbxCli.ts`) has no stdin hook, so this needed a small dedicated `runWithStdin` helper (`spawn` + write-to-stdin + collect output) rather than reusing the general-purpose `run()`.

Each service card also has a **password-manager fetch path** (`src/main/passwordManager.ts`) alongside the plain-paste input — pick a detected CLI (1Password's `op` or Bitwarden's `bw`), give it a reference (`op://Vault/Item/field`, or a Bitwarden item name/ID), and it resolves and saves the value without it ever populating the visible form field or passing through renderer state at all: the fetch (`op read <reference>` / `bw get password <reference>`) runs in the main process, and the raw value goes straight into the existing stdin-based `secretSet`/`runWithStdin` plumbing described above — the IPC round trip back to the renderer only ever carries success/failure, never the secret itself. Detection (`listPasswordManagers`, polled every 30s by the Secrets page) checks whether each binary exists on PATH and, if so, its sign-in/unlock state (`op whoami`; `bw status`'s JSON `status` field) — deliberately **not** attempted: driving either CLI's interactive sign-in or vault-unlock flow from this app. Those differ meaningfully per tool (`op signin`, `op`'s desktop-app biometric unlock, `bw login`, `bw unlock` needing a `BW_SESSION` env var this GUI process has no reliable way to inherit unless the launching shell exported it first) and are the same posture as every other external-tool integration here: if a manager isn't signed in, the fetch just fails with that CLI's own real error text, surfaced via the same error-display path as the plain-key form. **Not yet tested against real `op`/`bw` installs** — neither CLI is available on the machine this was built on, so the implementation follows each tool's documented command shapes rather than a live-verified protocol, unlike everything else in this section. Testing is deferred to a machine that actually has them installed.

Deliberately out of scope for v1 (asked and confirmed): registry pull credentials (`--registry`, for private kit/template images — a separate, less common concern from service API keys) and `sbx secret import` (auto-detecting host env vars like `OPENAI_API_KEY`).

**Settings** (`src/renderer/src/routes/Settings.tsx`) is the real Settings screen — it now owns the default sandbox view and default chat permissions pickers that used to live in the `UserBadge` dropdown, plus daemon status with Start/Restart/Stop controls (Restart and Stop are gated behind a confirm dialog — both make every running sandbox briefly or fully unreachable), a `sbx diagnose` viewer, and version/doc links. Sign in/out deliberately **stayed** in `UserBadge` rather than moving too — it's the account-status indicator (the colored initial, showing signed-in state at a glance), so the action that changes that state lives right there rather than a click away; Settings shows the same status read-only for context but the actual Sign in/Log out buttons are only in the badge dropdown, not duplicated in both places. One real gotcha: `sbx diagnose` exits non-zero the moment any check fails, even in `-o json` mode where stdout still carries a complete, valid report — a failing check is meaningful data to show the user, not a command failure to swallow. The shared `run()` helper used everywhere else rejects (and discards stdout) on a non-zero exit, so diagnose needed its own `runIgnoringExitCode` variant that only rejects when the binary is genuinely missing.

**First-run onboarding** lives directly in `Dashboard.tsx`, driven by the same `HealthStatus` (`binaryFound`/`daemonUp`/`loggedIn`) the health probe already computed for the old static gate messages — the three states just got real actions instead of "run this command and refresh" text: a missing `sbx` binary shows the `winget install -h Docker.sbx` command with a one-click **Copy** button and a **Recheck** button (re-invalidates the health query) rather than actually running the installer itself — installing software stays a manual, user-initiated terminal step even though the command is well-known and safe, the same posture as every other "don't auto-execute on the user's behalf" decision in this app; a stopped daemon gets an inline **Start daemon** button reusing the exact `useDaemonStart` mutation the Settings page's daemon controls already use; not being signed in gets an inline **Sign in to Docker** button reusing the exact `login()` flow `UserBadge`'s dropdown already uses (same OAuth-in-browser flow, just surfaced where a first-time user is already looking instead of requiring a trip to the badge menu). Once all three are green and no sandbox exists yet, a dismissed-by-nature (no persisted state — it just stops rendering once a sandbox exists) banner nudges toward the Policy page's tier switcher before the first `sbx create` implicitly auto-initializes a default tier — not a hard gate, since `sbx` already handles the no-tier-set case on its own, just a pointer to where that choice actually lives.

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

The app icon (`build/icon.ico`/`.icns`, auto-generated by electron-builder from `build/icon.png`) is Docker's own whale mark — the black variant, deliberately, so it reads as visually distinct from Docker Desktop's blue one in the taskbar. Using Docker's trademarked logo is fine here specifically because this repo is private with Docker-employee-only collaborators; it would not be an appropriate choice for a public, unaffiliated third-party tool.

**macOS** (must be run *on* a Mac — see [Running on macOS](#running-on-macos) below for why):

```bash
npm install       # needs Xcode Command Line Tools for node-pty — xcode-select --install
npm run build:mac
```

Produces `release/Docker Sandbox GUI-<version>-arm64.dmg` (Apple Silicon only, matching `sbx`'s own requirement). It's unsigned and unnotarized, so Gatekeeper will block it on first launch — right-click the app → **Open**, or `xattr -cr "/Applications/Docker Sandbox GUI.app"` from Terminal.

**Linux** (must be run *on* Linux — see [Running on Linux](#running-on-linux) below):

```bash
npm install       # needs build-essential + python3 for node-pty
npm run build:linux
```

Produces `release/Docker Sandbox GUI-<version>.AppImage` (x64). Unsigned, and — unlike Windows/macOS — has never actually been run on a real Linux machine by anyone yet; see the warning below before relying on it.

**Or via GitHub Actions** (`.github/workflows/release.yml`), instead of building all three platforms by hand: open the **Actions** tab → **Release** → **Run workflow**, type a version (e.g. `0.10.0`, no `v` prefix), and leave **Mark as a pre-release** checked until the app has had real-world testing beyond this repo. Deliberately **manually triggered** (`workflow_dispatch`), not on a tag push — the version is something to choose deliberately each time, not derive from commit history. It builds Windows (`nsis` + `msi`) on `windows-latest`, macOS (`.dmg`) on `macos-latest`, and Linux (`AppImage`) on `ubuntu-latest` — real hosts for each OS, unlike this project's own Windows dev machine, which can only actually build and test the Windows leg itself. macOS and Linux are both allowed to fail without blocking the release (`continue-on-error`): since both are genuinely untested, a first-run hiccup on either shouldn't hold back a Windows release; the release still goes out with whatever subset of installers actually built, and the workflow's own guard refuses to publish an *empty* release if somehow nothing built at all. Doesn't touch code signing — output is exactly as unsigned/unnotarized as a local build (see above); that's still a separate decision needing a Windows code-signing cert and an Apple Developer identity (Linux AppImages aren't typically signed at all).

Real bugs surfaced by the workflow's actual first few CI runs, none ever caught locally because local testing had only ever used `electron-builder --win dir` (the unpacked-directory target, which skips installer generation entirely) rather than the real `build:win`/`build:mac`/`build:linux` scripts:
- **The MSI target hard-fails without a custom app icon** — confirmed live: `error LGHT0094: The identifier 'Icon:...' could not be found`, a WiX linker error. NSIS and DMG both tolerate a missing icon (falling back to Electron's default with just a log line); MSI's WiX-based packaging does not. Fixed by adding `build/icon.png` (see above) — once present, electron-builder auto-generates the `.ico`/`.icns` for every target from that one source, no per-platform icon files needed.
- **electron-builder auto-detects CI and tries to implicitly publish itself**, failing with `GitHub Personal Access Token is not set` — it has its own built-in GitHub-publish integration that isn't what this project uses (publishing is handled by the `release` job's own `gh release create` step instead). Fixed with `--publish never` on the `build:win`/`build:mac`/`build:linux` npm scripts. Confirmed live that `publish: never` as a YAML key in `electron-builder.yml` does *not* work despite looking like the obvious fix — the YAML `publish` field expects a provider config object, and treated the literal string `"never"` as a plugin name to load, failing with `Cannot find module for publisher "never"`. `never` is only a valid value for the `--publish` *CLI flag*, not the YAML key.
- **The `release` job's own artifact-gathering broke on filenames with spaces** — confirmed live: `productName: Docker Sandbox GUI` means every installer filename has spaces in it (`Docker Sandbox GUI-0.10.0-arm64.dmg`), and the original script collected `find`'s output into a plain string, then passed it to `gh release create` unquoted — word-splitting broke each filename into fragments, which `gh` then tried to glob-match and failed on (`no matches found for `artifacts/macos-installer/Docker``). Fixed by switching to NUL-delimited `find -print0` piped into a bash array (`mapfile -d ''`) instead of a plain `$()` string, which is the standard-correct way to handle filenames with spaces in bash and was verified locally against files actually named with spaces before trusting it in CI again.

### Using the app

The Dashboard is what you land on — every sandbox you've created, with its status and quick actions:

![Dashboard](assets/sandbox_gui_dashboard.png)

1. **Sign in.** The circular badge in the top-right shows your Docker account. If you're not signed in, click it and choose **Sign in to Docker** — this opens your browser for the real `sbx login` OAuth flow. The same dropdown holds **Log out** and a link to **Settings**, where your defaults (default tab, default chat permission mode) actually live:

   ![Account badge dropdown](assets/sandbox_login.png)

2. **Create a sandbox.** Click **New sandbox** on the Dashboard and walk through the wizard: pick an agent, choose a workspace folder, set a name and (optionally) resource limits, attach any **Kits** you want (previewed live before you commit — shows exactly what credentials, network rules, and setup steps a kit will apply), optionally publish ports or add network deny rules, then review and create.

   <details>
   <summary>Wizard walkthrough (6 steps, click to expand)</summary>

   ![Step 1: choose an agent](assets/create_sandbox_1.png)
   ![Step 2: workspace](assets/create_sandbox_2.png)
   ![Step 3: name and resources](assets/create_sandbox_3.png)
   ![Step 4: kits](assets/create_sandbox_4.png)
   ![Step 5: ports and network](assets/create_sandbox_5.png)
   ![Step 6: review](assets/create_sandbox_6.png)

   </details>

3. **Run it.** Sandboxes you create start automatically; a stopped sandbox shows a **Run** button on its card.
4. **Chat, Terminal, Ports, or Policy.** Click into a sandbox to open its detail page — four tabs at the top, and switching between Chat/Terminal never loses anything (both stay live).

   Chat is the polished default: markdown, copyable code blocks, tool-use indicators, a **Permissions** dropdown if a command gets blocked (pick Auto or Bypass for that session, or switch to Terminal for a real interactive prompt), and a **Clear chat** button that ends the session for real (not just a visual reset — Claude's actual memory of the conversation is gone too). If the sandbox isn't signed in to Claude yet, a **Sign in to Claude** banner appears and drives the real OAuth flow — typing `/login` in chat does the same thing. Typing `/mcp` in chat shows each MCP connector's status as of when the session started, plus a banner pointing at Terminal if anything needs authorizing (that step genuinely can't happen from chat — see above).

   ![Chat tab](assets/sandbox_chat.png)

   Terminal is a real interactive session — slash-command pickers, autocomplete, and per-command approval prompts all work here, including the **Check /mcp** button that opens the live connector picker for you:

   ![Terminal tab](assets/sandbox_terminal.png)

   Ports and Policy manage that one sandbox's published ports and network rules:

   ![Ports tab](assets/sandbox_ports.png)
   ![Per-sandbox Policy tab](assets/sandbox_policy.png)

5. **MCP** (left nav) registers MCP servers, authorizes them (a real browser OAuth step — see the warning above), and loads an authorized server into any running sandbox.

   ![MCP servers page](assets/sandbox_gui_mcp.png)

6. **Policy** (left nav) sets the global network policy tier and manages global allow/deny rules, separately from the per-sandbox Policy tab.

   ![Global Policy page](assets/sandbox_gui_policy.png)

7. **Secrets** (left nav) stores the API keys and OAuth tokens agents authenticate with — one card per service, global by default or scoped to a single sandbox. `openai` gets a real OAuth sign-in button; `anthropic` gets a sandbox picker that drives the same pty-based Claude login used in Chat (its OAuth can't be started any other way); everything else takes a plain pasted API key or, if 1Password's `op`/Bitwarden's `bw` CLI is installed and signed in, a "Fetch & Save" path that resolves the value from a secret reference without it ever touching the visible form field (see above).

   ![Secrets page](assets/sandbox_gui_secrets.png)

8. **Settings** (left nav) holds your defaults (which tab new sandboxes open to, which permission mode new chat sessions start with), daemon status with Start/Restart/Stop controls, a live `sbx diagnose` viewer, and version/doc links. Sign in/out (shown above) stayed in the account badge dropdown rather than moving here.

   ![Settings page](assets/sandbox_gui_settings.png)

9. **Stop / Remove** from the sandbox card when you're done — Remove is permanent and asks for confirmation first.

Codex, Gemini, and docker-agent sandboxes now get the same structured Chat tab as Claude (markdown, tool-use indicators, the works) — see above for each protocol's specifics and gotchas. Any other agent type can still be created and run, and the Terminal tab works for them today (it's agent-agnostic), but the Chat tab will say it's in basic mode until a structured adapter is written for it.

### Running on macOS

> [!CAUTION]
> **Untested platform.** The application code is not Windows-specific and there's no known reason it shouldn't work, but no one has actually run this app on macOS yet — not once, not even the packaged build the release workflow now produces. Treat anything below as "should work" rather than "confirmed to work." If you hit an error, please report it in [Issues](https://github.com/SethBonser/Docker-SBX-GUI/issues) — that's real signal this project doesn't have yet.

The application code is already cross-platform — there's nothing Windows-specific in the source (binary path resolution already branches between `where`/`which`, no hardcoded paths or shell quoting that differs by OS). What's *not* possible from this Windows machine is producing a `.dmg` locally: `electron-builder` can't cross-build a macOS target from Windows, since `.app` bundling and code signing require Apple's own toolchain — the GitHub Actions release workflow (see above) now does this on a real `macos-latest` runner instead, but that's still just "it compiled," not "someone ran it." A Mac tester needs to either grab a build from a GitHub Release or clone the repo and build from source themselves, on their Mac, using the `npm run build:mac` steps above (or `npm run dev` for a quicker look) — they'll also need [Docker Sandboxes for Mac](https://docs.docker.com/ai/sandboxes/get-started/) (`brew install docker/tap/sbx`, then `sbx login`), which requires macOS Sonoma+ on Apple Silicon.

If anything behaves differently from the Windows build, that's genuinely useful signal — the only real testing this app has had so far is on Windows.

### Running on Linux

> [!CAUTION]
> **Untested platform.** Same caveat as macOS, arguably more so: the code has no known Linux-specific blockers, `sbx` itself fully supports Linux (Ubuntu 24.04+, official `apt` package), and `electron-builder.yml` has an AppImage target configured — but literally no one has ever run this app on Linux, and the AppImage build only started existing as of this section being written. Please report anything that breaks in [Issues](https://github.com/SethBonser/Docker-SBX-GUI/issues).

Docker Sandboxes is a first-class-supported platform on Linux, not an afterthought — [Docker's own docs](https://docs.docker.com/ai/sandboxes/get-started/) list Ubuntu 24.04+ (x64 or Arm) alongside Windows and macOS, installed via `sudo apt-get install docker-sbx` after adding Docker's apt repository, with KVM hardware virtualization required (and your user needs to be in the `kvm` group). This app's own code has no known Linux-specific gaps — same reasoning as the macOS section above — but unlike macOS, cross-building the Linux target from Windows is unlikely to work reliably either (AppImage packaging expects Linux-native tooling), so the GitHub Actions workflow's `ubuntu-latest` runner is currently the *only* place a Linux build has ever actually been produced. A Linux tester needs to either grab the AppImage from a GitHub Release, or build from source on their own Linux machine with `npm run build:linux` (needs `build-essential` and `python3` for `node-pty`'s native compile, the Linux equivalent of Windows' Build Tools / macOS's Xcode CLT).

## Planned / upcoming work

For an agent picking this project back up: the app is built incrementally, each piece built and verified live against a real `sbx` install before moving on (not from documentation assumptions alone — the CLI's actual JSON shapes, error text, and flag requirements were all confirmed by testing, including things that turned out to *not* work as assumed — see the gotchas above). Done so far: scaffold + packaging (now including a manually-triggered GitHub Actions release workflow covering Windows/macOS/Linux — see below), the Dashboard (now with real first-run onboarding, not just static gate messages — see below), the Create-sandbox wizard with Kits, structured chat panels for Claude, Codex, Gemini, and docker-agent (each with a live permission-mode/hang-avoidance flag and Clear chat), the embedded Terminal tab, per-sandbox Ports and Policy tabs, the global Policy page (tier switcher + custom rules), MCP server management (register/authorize/load), the Secrets manager (including its password-manager fetch path, implemented but not yet live-tested — see below), the real Settings screen (daemon controls + diagnostics), the Chat-tab `/mcp` status row and `/login`/`/mcp` aliasing, and the Docker/Anthropic sign-in flows described above.

**Next up:**
- **Structured chat adapter for remaining agent types** (e.g. Copilot, others as `sbx` adds them) — Claude, Codex, Gemini, and docker-agent are done (see above). The Terminal tab already gives any agent type a working *interactive* session today (it's agent-agnostic), so this is specifically about parsing a not-yet-covered agent's own headless/structured output mode (if one exists) into the same chat-bubble UI. Lower urgency now that Terminal covers the "can I use it at all" gap for every agent type regardless.
- **Real-world macOS and Linux testing** — both platforms now build successfully in CI (see below), but neither has actually been *run* by a person yet. This is the honest current gap, flagged loudly with `[!CAUTION]` callouts in the [Running on macOS](#running-on-macos)/[Running on Linux](#running-on-linux) sections rather than buried in this list.

**Already resolved (was previously listed here as deferred):**
- **A GitHub Actions release workflow** (`.github/workflows/release.yml`) covering Windows, macOS, *and* Linux — see "Building an installer" above for the full shape. Deliberately `workflow_dispatch` (manually triggered, with a typed-in version + a pre-release checkbox) rather than triggered on a tag push, per explicit request: the version is a deliberate choice made at release time, not something to derive automatically from commit history — useful right now specifically because this app is still in beta. **Confirmed live**: Windows and macOS builds both succeed end to end (three real bugs found and fixed along the way — missing app icon breaking the MSI target, electron-builder's implicit CI auto-publish, and a filenames-with-spaces bug in the release job's own script — see "Building an installer" above for all three). Linux was added after the fact, following the same `continue-on-error` pattern as macOS, and has never actually run yet. macOS *builds* successfully but — like Linux — has never actually been *run* by anyone; see the caution notes above.
- **Onboarding** — the Dashboard's old static "run this command and refresh" gate messages became real actions: a guided `winget install -h Docker.sbx` copy/recheck flow for a missing binary, inline Start-daemon/Sign-in buttons reusing the exact mutations Settings/`UserBadge` already had, and a first-run nudge toward the Policy page's tier switcher once the account is fully set up but no sandbox exists yet. See the architecture section above for the full shape and why the installer itself is never auto-run.
- **Password-manager integration for the Secrets page** (1Password `op` / Bitwarden `bw`) — see above for the full shape (detection, fetch-by-reference, the stdin-plumbing reuse, and why interactive sign-in/unlock is deliberately not attempted). Implemented but **not yet live-tested**, since neither CLI is installed on the machine this was built on — the one exception to this project's "verify against a real install before calling it done" rule so far. Testing is deferred to a machine that has `op`/`bw` available; treat the implementation as reviewed-but-unverified until then.
- **Structured chat adapters for Codex, Gemini, and docker-agent**, matching the same polished Chat tab Claude already had — see above for each protocol's specifics (one-shot-per-message execution, resume mechanics, streaming-delta buffering, and the hang/credential gotchas found for each). `ChatPanel.tsx` now gates its Claude-only UI (the `/login` banner, the Permissions picker) behind an `isClaude` check rather than assuming Claude is the only structured agent.
- **In-chat interactive menus** (`/mcp`, autocomplete, other slash-command pickers) *for the Chat tab specifically* remain structurally impossible — confirmed even more concretely than before: Claude Code's own harness explicitly refuses `/mcp reconnect`/`auth`/`enable`/`disable` in a headless session ("aren't available in this session"), it's not just an unimplemented picker. The Terminal tab (`xterm.js` + `node-pty`) is the answer for anything needing that real interactivity, and now has a one-click "Check /mcp" button plus deep-links from both the Chat banner and the MCP page's per-server rows.
- **Ports and Policy tabs** on the sandbox detail page, plus a **global Policy page** (tier switcher + custom rules), an **MCP server management page** (register/authorize/load), a **Secrets manager** (per-service API keys/OAuth, global or per-sandbox), and a **real Settings screen** (default view/permission-mode, daemon status/start/stop/restart, an `sbx diagnose` viewer, version/doc links) in the left nav — all done, see above. Sign in/out deliberately stayed in the `UserBadge` dropdown rather than moving to Settings too (see above for why); the default-view/default-permission-mode toggles are the pieces that actually moved.

**Still deliberately deferred (with reasoning, so it isn't re-litigated from scratch):**
- **Authorizing an MCP connector from Chat** — not a missing feature, a hard platform limitation (see above). Don't re-attempt scripting it through the headless protocol; the Terminal tab is the only real path, and Chat already links to it.
- **Some claude.ai connectors (Gmail, Google Calendar, Microsoft 365) can't be authorized from this app at all** — confirmed against Anthropic's own docs: those specific hosts don't support local OAuth from Claude Code because the upstream identity provider only accepts the redirect URL claude.ai itself registered. Even the Terminal's real `/mcp` picker just points at `claude.ai/customize/connectors` for those three. Not a bug to fix here.
- **Registry secrets and `sbx secret import`** — asked and confirmed out of scope for the Secrets manager's v1: registry pull credentials are a separate, less common concern from service API keys, and env-var auto-detection is a convenience layered on top of the same `secretSet`/`secretList` plumbing already built, not a blocker to add later.
- **Kit authoring** (`sbx kit pack`/`push`) — the app only *uses* kits (inspect/validate/apply), doesn't build them.
- `sbx skills` UI, `sbx cp` (file transfer) UI.
- **macOS code signing and notarization** — needs an Apple Developer identity and an actual Mac; the `.dmg` build is otherwise ready to go (see above).
- **Auto-update.**
