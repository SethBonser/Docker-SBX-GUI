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
  if (text.includes('daemon') && (text.includes('not running') || text.includes('unavailable'))) {
    return new SbxCliError('DaemonDown', 'The sandboxd daemon is not running.', { exitCode, stderr })
  }
  if (text.includes('no such sandbox') || text.includes('sandbox not found')) {
    return new SbxCliError('SandboxNotFound', 'Sandbox not found.', { exitCode, stderr })
  }
  if (text.includes('kit') && (text.includes('invalid') || text.includes('validation failed'))) {
    return new SbxCliError('KitInvalid', 'Kit artifact failed validation.', { exitCode, stderr })
  }
  return new SbxCliError('Generic', stderr.trim() || `sbx exited with code ${exitCode}`, { exitCode, stderr })
}
