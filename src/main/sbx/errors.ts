export type SbxErrorKind =
  | 'BinaryNotFound'
  | 'DaemonDown'
  | 'NotLoggedIn'
  | 'SandboxNotFound'
  | 'KitInvalid'
  | 'Generic'

export class SbxCliError extends Error {
  readonly kind: SbxErrorKind
  readonly exitCode: number | null
  readonly stderr: string

  constructor(kind: SbxErrorKind, message: string, opts: { exitCode?: number | null; stderr?: string } = {}) {
    super(message)
    this.name = 'SbxCliError'
    this.kind = kind
    this.exitCode = opts.exitCode ?? null
    this.stderr = opts.stderr ?? ''
  }
}

/** Classify a failed `sbx` invocation from its exit code / stderr text. */
export function classifyFailure(stderr: string, exitCode: number | null): SbxCliError {
  const text = stderr.toLowerCase()

  if (text.includes('not logged in') || text.includes('please run') || text.includes('sbx login')) {
    return new SbxCliError('NotLoggedIn', 'Not logged in to Docker. Run the login flow first.', {
      exitCode,
      stderr
    })
  }
  // Two confirmed-live shapes for "the daemon isn't reachable," not one — the original
  // "daemon"+"not running"/"unavailable" phrasing, and (found later, from a real failure) a
  // completely different one where `sbx ls` fails trying to reach the daemon's own runtime
  // socket: "list runtimes: Get \"http://socket/sandbox\": open \\.\pipe\docker_..._sandboxd:
  // The system cannot find the file specified" on Windows — the daemon process (and the named
  // pipe it would be listening on) simply doesn't exist. Never contains the word "daemon" at
  // all, so the original check alone missed it entirely and it fell through to a raw, unhelpful
  // error dump instead of the same "start the daemon" UI a plain daemon-down state already gets.
  // The Windows wording (a named pipe, "cannot find the file specified") is confirmed live; the
  // equivalent on macOS/Linux would be a Unix socket path and a "no such file or directory"/
  // "connection refused" style message — not yet confirmed live on either platform, so `list
  // runtimes` (present in both known Windows failures so far) is the one piece checked here
  // rather than guessing at OS-specific socket-error wording.
  if (
    text.includes('list runtimes') ||
    (text.includes('daemon') && (text.includes('not running') || text.includes('unavailable')))
  ) {
    return new SbxCliError('DaemonDown', 'The sandboxd daemon is not running or is unreachable.', {
      exitCode,
      stderr
    })
  }
  if (text.includes('no such sandbox') || text.includes('sandbox not found')) {
    return new SbxCliError('SandboxNotFound', 'Sandbox not found.', { exitCode, stderr })
  }
  if (text.includes('kit') && (text.includes('invalid') || text.includes('validation failed'))) {
    return new SbxCliError('KitInvalid', 'Kit artifact failed validation.', { exitCode, stderr })
  }
  return new SbxCliError('Generic', stderr.trim() || `sbx exited with code ${exitCode}`, { exitCode, stderr })
}
