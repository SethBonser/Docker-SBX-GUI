import { readdir } from 'fs/promises'
import { join } from 'path'
import { sbxCli } from './sbx/sbxCli'

/**
 * Skills found under <workspace>/.claude/skills/ on the host — this is the fast, side-effect-
 * free path, since it's just a local disk read via the bind-mounted workspace, no `sbx exec`
 * round trip into the sandbox needed. Returns an empty list rather than an error when there's
 * no skills directory at all, since most sandboxes won't have one — that's a normal, expected
 * case, not a failure.
 */
async function listHostSkills(workspace: string): Promise<string[]> {
  const skillsDir = join(workspace, '.claude', 'skills')
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

/**
 * Claude Code Skills usually live under <workspace>/.claude/skills/ (the host-visible case
 * above), but a kit's own setup steps could install one directly into the sandbox's container
 * filesystem instead — somewhere never mirrored to the host disk at all, so a plain host-side
 * read can never see it. `listDirNamesInSandbox` (sbxCli.ts) covers that case via `sbx exec`,
 * checked *in addition to* the host workspace, not only as a fallback — a user could have
 * skills they want to reference sitting in either place (or, confirmed live, both at once for
 * the same skill), so both are queried and the combined name list is deduped rather than one
 * source winning outright. Duplicates across sources are only ever a display concern, never a
 * "which copy is real" one — selecting a skill just inserts its plain `/<name>` as text; this
 * app never reads or resolves the underlying file itself, so there's nothing to reconcile.
 *
 * Only checks inside the sandbox when it's already `running`: `sbx exec` starts a stopped
 * sandbox as a side effect (confirmed live — see sbxCli.ts's own `start()`), and silently
 * starting someone's sandbox just because they opened the Chat tab would be a surprising,
 * unwanted side effect of a feature that's only ever meant to be a convenience.
 *
 * NOT YET CONFIRMED LIVE — the exact in-sandbox path a kit-installed skill would end up in
 * hasn't been verified against a real sandbox. `~/.claude/skills` (Claude Code's standard
 * user-level skills location) is the best-reasoned guess, not a confirmed one.
 */
export async function listSandboxSkills(sandboxName: string): Promise<string[]> {
  const sandboxes = await sbxCli.ls()
  const sandbox = sandboxes.find((s) => s.name === sandboxName)
  if (!sandbox) return []

  const hostSkills = sandbox.workspace ? await listHostSkills(sandbox.workspace) : []

  let inSandboxSkills: string[] = []
  if (sandbox.status === 'running') {
    try {
      inSandboxSkills = await sbxCli.listDirNamesInSandbox(sandboxName, '~/.claude/skills')
    } catch {
      inSandboxSkills = []
    }
  }

  return [...new Set([...hostSkills, ...inSandboxSkills])].sort((a, b) => a.localeCompare(b))
}
