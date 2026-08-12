import type { ClaudePermissionMode } from '@shared/types'

// See the ClaudePermissionMode type definition for what was actually confirmed for each mode.
export const PERMISSION_MODE_OPTIONS: Array<{ value: ClaudePermissionMode; label: string }> = [
  { value: 'default', label: 'Default (may block risky commands)' },
  { value: 'acceptEdits', label: 'Accept edits (auto-approve file edits only)' },
  { value: 'auto', label: 'Auto (works around blocks, slower)' },
  { value: 'dontAsk', label: "Don't ask (stricter — blocks Bash outright)" },
  { value: 'bypassPermissions', label: 'Bypass all checks (use with caution)' },
  { value: 'plan', label: 'Plan only (read-only, never executes)' }
]
