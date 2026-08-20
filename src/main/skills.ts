import { readdir } from 'fs/promises'
import { join } from 'path'
import { sbxCli } from './sbx/sbxCli'

/**
 * Claude Code Skills live as subdirectories under <workspace>/.claude/skills/ on the host —
 * this is a Claude Code concept, not an `sbx` one, so there's no CLI command to list them.
 * This reads the sandbox's own primary workspace directly off disk instead. Returns an empty
 * list rather than an error when there's no skills directory at all, since most sandboxes
 * won't have one — that's a normal, expected case, not a failure.
 */
export async function listSandboxSkills(sandboxName: string): Promise<string[]> {
  const sandboxes = await sbxCli.ls()
  const sandbox = sandboxes.find((s) => s.name === sandboxName)
  if (!sandbox?.workspace) return []

  const skillsDir = join(sandbox.workspace, '.claude', 'skills')
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}
