import { useState } from 'react'
import { Badge } from './ui/Badge'
import { useKitLibrary } from '@renderer/state/queries'
import { useRefreshKitLibraryEntry } from '@renderer/state/mutations'
import type { KitLibraryEntry } from '@shared/types'

/**
 * The whole point of the local kit library (see src/main/kitLibrary.ts) is to make kits you've
 * already used trivial to reuse — shared between the Create wizard's Kits step and a sandbox's
 * own Kits tab, so both offer the same library instead of making the user re-pick the same
 * folder/ZIP or re-type the same OCI/git reference every time.
 */
export function ExistingKitPicker({
  selectedReferences,
  onSelect
}: {
  selectedReferences: string[]
  onSelect: (entry: KitLibraryEntry) => void
}): JSX.Element | null {
  const kitLibrary = useKitLibrary()
  const refreshEntry = useRefreshKitLibraryEntry()
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  if (kitLibrary.isLoading) {
    return <p className="text-sm text-slate-500">Loading your kit library…</p>
  }
  if (!kitLibrary.data || kitLibrary.data.length === 0) {
    return null
  }

  // For a local kit, re-sync the stored copy from its original folder/ZIP before reuse — that
  // copy exists to survive the original being moved/deleted, which also means reuse would
  // otherwise silently apply whatever content existed the first time this kit was ever added,
  // not any edits made since (see the note above `refreshLocalKitEntry` in kitLibrary.ts). If
  // the original is gone or the refresh fails for any reason, fall back to the existing stored
  // copy rather than blocking the user — same posture as the rest of this app's kit handling.
  async function handleSelect(entry: KitLibraryEntry): Promise<void> {
    if (entry.sourceType !== 'local') {
      onSelect(entry)
      return
    }
    setRefreshingId(entry.id)
    try {
      const refreshed = await refreshEntry.mutateAsync(entry.id)
      onSelect(refreshed)
    } catch {
      onSelect(entry)
    } finally {
      setRefreshingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-medium text-slate-300">Use existing</h4>
      <p className="text-xs text-slate-500">
        Kits you've used before, from this app's own history (see the Kits page in the left nav).
      </p>
      <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {kitLibrary.data.map((entry) => {
          const added = selectedReferences.includes(entry.reference)
          const refreshing = refreshingId === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              disabled={added || refreshing}
              onClick={() => void handleSelect(entry)}
              className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-left text-sm ${
                added || refreshing
                  ? 'cursor-default border-slate-800 bg-slate-900/50 opacity-60'
                  : 'border-slate-800 bg-slate-900 hover:border-slate-600'
              }`}
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-slate-200">
                  {entry.manifest.manifest?.displayName ?? entry.manifest.manifest?.name ?? entry.originalReference}
                </span>
                {added && <Badge tone="success">added</Badge>}
                {refreshing && <Badge tone="neutral">syncing…</Badge>}
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Badge tone="neutral">{entry.sourceType}</Badge>
                <span>last used {new Date(entry.lastUsedAt).toLocaleDateString()}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
