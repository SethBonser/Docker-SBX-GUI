import { Link } from 'react-router-dom'
import { Badge } from '@renderer/components/ui/Badge'
import { Card } from '@renderer/components/ui/Card'
import { useKitLibrary } from '@renderer/state/queries'
import { useRemoveKitLibraryEntry } from '@renderer/state/mutations'

export function Kits(): JSX.Element {
  const kitLibrary = useKitLibrary()
  const removeEntry = useRemoveKitLibraryEntry()

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Kits</h1>
        <p className="mt-1 text-sm text-slate-400">
          A personal history of kits you've used through this app — not a Docker-published
          catalog. <code>sbx</code> has no built-in kit registry or discovery command, so this
          list only grows as you add kits from the Create Sandbox wizard or a sandbox's Kits tab.
        </p>
      </div>

      {kitLibrary.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {kitLibrary.isError && (
        <p className="text-sm text-red-400">{(kitLibrary.error as Error).message}</p>
      )}

      {kitLibrary.data && kitLibrary.data.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">
            No kits used yet. Add one while creating a sandbox, or from an existing sandbox's{' '}
            <span className="text-slate-300">Kits</span> tab.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {kitLibrary.data?.map((k) => (
          <Card key={k.id} className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium text-slate-200">
                  {k.manifest.manifest.displayName ?? k.manifest.manifest.name}
                </div>
                <div className="truncate text-xs text-slate-500" title={k.originalReference}>
                  {k.originalReference}
                </div>
              </div>
              <button
                className="flex-shrink-0 text-xs text-red-400 hover:text-red-300"
                disabled={removeEntry.isPending}
                onClick={() => {
                  if (confirm(`Remove "${k.manifest.manifest.name}" from this library?`)) {
                    removeEntry.mutate(k.id)
                  }
                }}
              >
                remove
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{k.sourceType}</Badge>
              <Badge tone="neutral">{k.manifest.manifest.kind}</Badge>
              <span className="text-xs text-slate-600">
                last used {new Date(k.lastUsedAt).toLocaleDateString()}
              </span>
            </div>

            {k.manifest.manifest.description && (
              <p className="text-xs text-slate-400">{k.manifest.manifest.description}</p>
            )}

            {k.appliedTo.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
                <span>Applied to:</span>
                {k.appliedTo.map((sb) => (
                  <Link
                    key={sb}
                    to={`/sandboxes/${sb}?tab=kits`}
                    className="rounded-full border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-slate-500"
                  >
                    {sb}
                  </Link>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
