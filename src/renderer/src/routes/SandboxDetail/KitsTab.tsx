import { useState } from 'react'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { useKitLibrary } from '@renderer/state/queries'
import { useKitAdd, useRecordKitUsage } from '@renderer/state/mutations'
import type { KitDetails, KitSourceType, KitValidationResult } from '@shared/types'

interface DraftKit {
  reference: string
  sourceType: KitSourceType
  inspecting: boolean
  details?: KitDetails
  validation?: KitValidationResult
  error?: string
}

export function KitsTab({ sandboxName }: { sandboxName: string }): JSX.Element {
  const kitLibrary = useKitLibrary()
  const kitAdd = useKitAdd(sandboxName)
  const recordKitUsage = useRecordKitUsage()
  const [refDraft, setRefDraft] = useState('')
  const [draft, setDraft] = useState<DraftKit | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  const appliedKits = (kitLibrary.data ?? []).filter((k) => k.appliedTo.includes(sandboxName))
  const busy = draft?.inspecting || kitAdd.isPending || recordKitUsage.isPending

  async function inspectDraft(reference: string, sourceType: KitSourceType): Promise<void> {
    setDraft({ reference, sourceType, inspecting: true })
    try {
      const [details, validation] = await Promise.all([
        window.sbxApi.kitInspect(reference),
        window.sbxApi.kitValidate(reference)
      ])
      setDraft({ reference, sourceType, inspecting: false, details, validation })
    } catch (err) {
      setDraft({ reference, sourceType, inspecting: false, error: (err as Error).message })
    }
  }

  async function pickLocalKitFolder(): Promise<void> {
    const picked = await window.sbxApi.pickKitDirectory()
    if (picked) await inspectDraft(picked, 'local')
  }

  async function pickLocalKitZip(): Promise<void> {
    const picked = await window.sbxApi.pickKitZip()
    if (picked) await inspectDraft(picked, 'local')
  }

  async function submitReference(): Promise<void> {
    const reference = refDraft.trim()
    if (!reference) return
    await inspectDraft(reference, reference.startsWith('git+') ? 'git' : 'oci')
  }

  async function handleAdd(): Promise<void> {
    if (!draft?.details) return
    if (
      !confirm(
        `Add "${draft.details.manifest.name}" to ${sandboxName}? The sandbox's container will be recreated to apply it — a brief interruption, and this can't be undone through this app (sbx has no way to remove a kit once added).`
      )
    ) {
      return
    }
    setAddError(null)
    try {
      await kitAdd.mutateAsync(draft.reference)
      await recordKitUsage.mutateAsync({
        reference: draft.reference,
        sourceType: draft.sourceType,
        manifest: draft.details,
        sandboxName
      })
      setDraft(null)
      setRefDraft('')
    } catch (err) {
      setAddError((err as Error).message)
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div>
        <h2 className="text-sm font-semibold text-slate-300">Kits applied to this sandbox</h2>
        <p className="mt-1 text-xs text-slate-500">
          <code>sbx</code> has no way to list which kits are on a sandbox, so this only reflects
          kits added through this app — a kit applied via the CLI directly won't show up here.
        </p>
      </div>

      {kitLibrary.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {kitLibrary.isError && (
        <p className="text-sm text-red-400">{(kitLibrary.error as Error).message}</p>
      )}

      {kitLibrary.data && appliedKits.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">No kits added through this app yet.</p>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {appliedKits.map((k) => (
          <Card key={k.id} className="flex animate-fade-in items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-200">
                  {k.manifest.manifest.displayName ?? k.manifest.manifest.name}
                </span>
                <Badge tone="neutral">{k.sourceType}</Badge>
                <Badge tone="neutral">{k.manifest.manifest.kind}</Badge>
              </div>
              {k.manifest.manifest.description && (
                <p className="mt-1 text-xs text-slate-400">{k.manifest.manifest.description}</p>
              )}
              <p className="mt-1 truncate text-xs text-slate-600" title={k.originalReference}>
                {k.originalReference}
              </p>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-800 pt-4">
        <h3 className="text-sm font-semibold text-slate-300">Add a kit</h3>
        <p className="text-xs text-slate-500">
          Kits stack — adding one appends to the sandbox's existing kit list rather than replacing
          it. Applying a kit recreates the sandbox's container (a brief interruption).
        </p>

        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void pickLocalKitFolder()}>
            Pick local folder
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void pickLocalKitZip()}>
            Pick local ZIP
          </Button>
          <input
            value={refDraft}
            onChange={(e) => setRefDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submitReference()}
            placeholder="OCI or git reference (e.g. ghcr.io/org/kit:1.0)"
            disabled={busy}
            className="flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          />
          <Button variant="secondary" disabled={busy || !refDraft.trim()} onClick={() => void submitReference()}>
            Inspect
          </Button>
        </div>

        {draft?.inspecting && <p className="text-sm text-slate-400">Inspecting…</p>}
        {draft?.error && <p className="text-sm text-red-400">{draft.error}</p>}

        {draft?.details && (
          <Card className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-200">
                {draft.details.manifest.displayName ?? draft.details.manifest.name}
              </span>
              <Badge tone="neutral">{draft.sourceType}</Badge>
              <Badge tone="neutral">{draft.details.manifest.kind}</Badge>
              {draft.validation && (
                <Badge tone={draft.validation.valid ? 'success' : 'danger'}>
                  {draft.validation.valid ? 'valid' : 'invalid'}
                </Badge>
              )}
            </div>
            {draft.details.manifest.description && (
              <p className="text-xs text-slate-400">{draft.details.manifest.description}</p>
            )}
            {draft.details.credentials && draft.details.credentials.length > 0 && (
              <p className="text-xs text-slate-500">
                Credentials: {draft.details.credentials.map((c) => c.service).join(', ')}
              </p>
            )}
            {draft.details.caps?.network && (
              <p className="text-xs text-slate-500">
                Network — allow: {draft.details.caps.network.allow?.join(', ') || 'none'}, deny:{' '}
                {draft.details.caps.network.deny?.join(', ') || 'none'}
              </p>
            )}
            <div className="flex items-center gap-2 pt-1">
              <Button
                disabled={busy || draft.validation?.valid === false}
                onClick={() => void handleAdd()}
              >
                {kitAdd.isPending ? 'Adding…' : `Add to ${sandboxName}`}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {addError && <p className="text-sm text-red-400">{addError}</p>}
      </div>
    </div>
  )
}
