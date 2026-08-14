import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { cp, mkdir, rm } from 'fs/promises'
import { basename, join } from 'path'
import { app } from 'electron'
import Store from 'electron-store'
import type { KitDetails, KitLibraryEntry, KitSourceType } from '@shared/types'

// This app's own local record of kits it has successfully applied — see the KitLibraryEntry
// doc comment in shared/types.ts for why this exists (sbx has no way to list or remove kits,
// only add them). Local (directory/ZIP) kit references get copied into kitsDir on first use so
// the library survives the original source moving or being deleted; OCI/git references are
// already portable and are kept as plain reference strings.

interface KitLibrarySchema {
  entries: KitLibraryEntry[]
}

const store = new Store<KitLibrarySchema>({ name: 'kit-library', defaults: { entries: [] } })

function kitsDir(): string {
  return join(app.getPath('userData'), 'kits')
}

/** Dedup key: local kits are identified by their original source path, not the copied one. */
function dedupKey(sourceType: KitSourceType, originalReference: string): string {
  return `${sourceType}:${originalReference}`
}

async function copyLocalKitToStorage(originalReference: string, id: string): Promise<string> {
  const dir = join(kitsDir(), id)
  await mkdir(dir, { recursive: true })

  const stat = statSync(originalReference)
  if (stat.isDirectory()) {
    await cp(originalReference, dir, { recursive: true })
    return dir
  }

  const dest = join(dir, basename(originalReference))
  await cp(originalReference, dest)
  return dest
}

export async function recordKitUsage(opts: {
  reference: string
  sourceType: KitSourceType
  manifest: KitDetails
  sandboxName: string
}): Promise<void> {
  const entries = store.get('entries')
  const key = dedupKey(opts.sourceType, opts.reference)
  const existing = entries.find((e) => dedupKey(e.sourceType, e.originalReference) === key)
  const now = new Date().toISOString()

  if (existing) {
    existing.manifest = opts.manifest
    existing.lastUsedAt = now
    if (!existing.appliedTo.includes(opts.sandboxName)) existing.appliedTo.push(opts.sandboxName)
    store.set('entries', entries)
    return
  }

  const id = randomUUID()
  const storedReference =
    opts.sourceType === 'local' ? await copyLocalKitToStorage(opts.reference, id) : opts.reference

  const entry: KitLibraryEntry = {
    id,
    reference: storedReference,
    sourceType: opts.sourceType,
    originalReference: opts.reference,
    manifest: opts.manifest,
    firstUsedAt: now,
    lastUsedAt: now,
    appliedTo: [opts.sandboxName]
  }
  store.set('entries', [...entries, entry])
}

export function listKitLibrary(): KitLibraryEntry[] {
  return store.get('entries')
}

export async function removeKitLibraryEntry(id: string): Promise<void> {
  const entries = store.get('entries')
  const entry = entries.find((e) => e.id === id)
  store.set(
    'entries',
    entries.filter((e) => e.id !== id)
  )
  if (entry?.sourceType === 'local') {
    const dir = join(kitsDir(), id)
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true })
  }
}
