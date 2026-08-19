import { useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { Badge } from '@renderer/components/ui/Badge'
import { Card } from '@renderer/components/ui/Card'
import { useCreateSandbox, useRecordKitUsage, useRefreshKitLibraryEntry } from '@renderer/state/mutations'
import { useGpuFeatureEnabled, useKitLibrary } from '@renderer/state/queries'
import type { AgentType, KitDetails, KitLibraryEntry, KitSourceType, KitValidationResult } from '@shared/types'

const AGENTS: AgentType[] = [
  'claude',
  'codex',
  'copilot',
  'cursor',
  'docker-agent',
  'droid',
  'gemini',
  'kiro',
  'opencode',
  'shell'
]

const STEPS = ['Agent', 'Workspace', 'Name & Resources', 'Kits', 'Ports & Network', 'Review'] as const

interface ExtraWorkspace {
  path: string
  readOnly: boolean
}

interface KitEntry {
  reference: string
  sourceType: KitSourceType
  inspecting: boolean
  details?: KitDetails
  validation?: KitValidationResult
  error?: string
  // Set when this kit came from the "Use existing" library picker rather than a fresh pick —
  // threaded through to recordKitUsage so reusing a library entry updates it in place instead
  // of being misidentified as a new kit (its `reference` is this app's own stored-copy path,
  // not the library entry's user-facing originalReference the default dedup logic keys off of).
  libraryEntryId?: string
}

export function CreateSandboxWizard({ onClose }: { onClose: () => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const [agent, setAgent] = useState<AgentType>('claude')
  const [primaryWorkspace, setPrimaryWorkspace] = useState<string | null>(null)
  const [extraWorkspaces, setExtraWorkspaces] = useState<ExtraWorkspace[]>([])
  const [name, setName] = useState('')
  const [memory, setMemory] = useState('')
  const [cpus, setCpus] = useState('')
  const [gpu, setGpu] = useState(false)
  const [kits, setKits] = useState<KitEntry[]>([])
  const [ports, setPorts] = useState<string[]>([])
  const [portDraft, setPortDraft] = useState('')
  const [denyNetwork, setDenyNetwork] = useState<string[]>([])
  const [denyDraft, setDenyDraft] = useState('')

  const createSandbox = useCreateSandbox()
  const recordKitUsage = useRecordKitUsage()
  const gpuFeatureEnabled = useGpuFeatureEnabled()
  // Confirmed live via `sbx run --help`/`sbx create --help`: "Linux x86_64, single NVIDIA GPU."
  // Only offered when both the host itself can support it and the daemon-level feature flag is
  // on — passing --gpu in any other state is untested territory this app shouldn't guess at.
  const gpuAvailable = window.sbxApi.platform === 'linux' && gpuFeatureEnabled.data === true

  async function inspectAndValidateKit(reference: string): Promise<void> {
    setKits((prev) => prev.map((k) => (k.reference === reference ? { ...k, inspecting: true } : k)))
    try {
      const [details, validation] = await Promise.all([
        window.sbxApi.kitInspect(reference),
        window.sbxApi.kitValidate(reference)
      ])
      setKits((prev) =>
        prev.map((k) => (k.reference === reference ? { ...k, inspecting: false, details, validation } : k))
      )
    } catch (err) {
      setKits((prev) =>
        prev.map((k) =>
          k.reference === reference ? { ...k, inspecting: false, error: (err as Error).message } : k
        )
      )
    }
  }

  function addKitReference(reference: string, sourceType: KitSourceType, libraryEntryId?: string): void {
    if (!reference || kits.some((k) => k.reference === reference)) return
    setKits((prev) => [...prev, { reference, sourceType, inspecting: true, libraryEntryId }])
    void inspectAndValidateKit(reference)
  }

  async function pickKitFolder(): Promise<void> {
    const picked = await window.sbxApi.pickKitDirectory()
    if (picked) addKitReference(picked, 'local')
  }

  async function pickKitZip(): Promise<void> {
    const picked = await window.sbxApi.pickKitZip()
    if (picked) addKitReference(picked, 'local')
  }

  async function pickPrimaryWorkspace(): Promise<void> {
    const picked = await window.sbxApi.pickWorkspaceFolder()
    if (picked) {
      setPrimaryWorkspace(picked)
      if (!name) {
        const base = picked.split(/[\\/]/).filter(Boolean).pop() ?? 'sandbox'
        setName(`${agent}-${base}`.toLowerCase().replace(/[^a-z0-9.+-]/g, '-'))
      }
    }
  }

  async function pickExtraWorkspace(): Promise<void> {
    const picked = await window.sbxApi.pickWorkspaceFolder()
    if (picked) setExtraWorkspaces((prev) => [...prev, { path: picked, readOnly: true }])
  }

  const canCreate = Boolean(primaryWorkspace) && name.trim().length > 0

  async function handleCreate(): Promise<void> {
    if (!primaryWorkspace) return
    const workspaces = [primaryWorkspace, ...extraWorkspaces.map((w) => (w.readOnly ? `${w.path}:ro` : w.path))]
    const trimmedName = name.trim()
    await createSandbox.mutateAsync({
      agent,
      name: trimmedName,
      workspaces,
      memory: memory.trim() || undefined,
      cpus: cpus.trim() ? Number(cpus.trim()) : undefined,
      publish: ports.length ? ports : undefined,
      denyNetwork: denyNetwork.length ? denyNetwork : undefined,
      kits: kits.length ? kits.map((k) => k.reference) : undefined,
      gpu: gpuAvailable && gpu ? true : undefined
    })
    // Best-effort bookkeeping for the Kits library page — a failure here shouldn't undo an
    // otherwise-successful sandbox creation, so these aren't awaited as part of the create flow.
    for (const k of kits) {
      if (k.details && k.validation?.valid !== false) {
        void recordKitUsage.mutateAsync({
          reference: k.reference,
          sourceType: k.sourceType,
          manifest: k.details,
          sandboxName: trimmedName,
          libraryEntryId: k.libraryEntryId
        })
      }
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex h-[85vh] w-[90vw] max-w-4xl overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
        <aside className="w-48 flex-shrink-0 border-r border-slate-800 p-4">
          <h2 className="mb-4 text-sm font-semibold text-slate-300">New Sandbox</h2>
          <ol className="flex flex-col gap-1">
            {STEPS.map((label, i) => (
              <li key={label}>
                <button
                  onClick={() => setStep(i)}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    i === step ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {i + 1}. {label}
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 min-w-0 flex-1 overflow-auto p-6">
            {step === 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-base font-semibold">Choose an agent</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {AGENTS.map((a) => (
                    <button
                      key={a}
                      onClick={() => setAgent(a)}
                      className={`rounded-md border px-3 py-2 text-left text-sm ${
                        agent === a
                          ? 'border-indigo-500 bg-indigo-950 text-indigo-200'
                          : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-base font-semibold">Workspace</h3>
                  <p className="text-sm text-slate-500">
                    The host folder that becomes this sandbox's primary workspace.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => void pickPrimaryWorkspace()}>
                    Choose folder…
                  </Button>
                  <span className="truncate text-sm text-slate-400">
                    {primaryWorkspace ?? 'No folder selected'}
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-slate-300">Additional workspaces (read-only)</h4>
                  <div className="mt-2 flex flex-col gap-2">
                    {extraWorkspaces.map((w, i) => (
                      <div key={w.path} className="flex items-center gap-2 text-sm text-slate-400">
                        <span className="truncate">{w.path}</span>
                        <Badge tone="neutral">:ro</Badge>
                        <button
                          className="text-red-400 hover:text-red-300"
                          onClick={() => setExtraWorkspaces((prev) => prev.filter((_, idx) => idx !== i))}
                        >
                          remove
                        </button>
                      </div>
                    ))}
                    <Button variant="ghost" className="w-fit" onClick={() => void pickExtraWorkspace()}>
                      + Add read-only workspace
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <h3 className="text-base font-semibold">Name & resources</h3>
                <label className="flex flex-col gap-1 text-sm">
                  Sandbox name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-100"
                    placeholder="my-sandbox"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Memory limit (optional — e.g. 1024m, 8g)
                  <input
                    value={memory}
                    onChange={(e) => setMemory(e.target.value)}
                    className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-100"
                    placeholder="Default: 50% of host memory"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  CPUs (optional)
                  <input
                    value={cpus}
                    onChange={(e) => setCpus(e.target.value.replace(/[^0-9]/g, ''))}
                    className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-100"
                    placeholder="Default: all host CPUs"
                  />
                </label>

                {/*
                  Hidden entirely on non-Linux rather than shown-but-disabled: confirmed live via
                  sbx's own --help text that this is permanently Linux x86_64-only, not just "off
                  right now" — there's no toggle or setup step on Windows/macOS that ever makes it
                  reachable, unlike the "enable the flag in Settings first" case below, which is a
                  real actionable path on Linux. A disabled control with no way to ever enable it
                  is just noise.
                */}
                {window.sbxApi.platform === 'linux' && (
                  <div className="flex items-start gap-2 border-t border-slate-800 pt-3">
                    <input
                      type="checkbox"
                      id="gpu-passthrough"
                      checked={gpu}
                      disabled={!gpuAvailable}
                      onChange={(e) => setGpu(e.target.checked)}
                      className="mt-1"
                    />
                    <label htmlFor="gpu-passthrough" className="flex flex-col gap-0.5 text-sm">
                      <span className="flex items-center gap-2 text-slate-200">
                        Pass host GPU through to this sandbox
                        <Badge tone="warning">experimental</Badge>
                      </span>
                      {gpuAvailable ? (
                        <span className="text-xs text-slate-500">
                          NVIDIA VFIO passthrough, single GPU. Must be set now — this cannot be
                          added to the sandbox later.
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">
                          Turn this on in Settings first (GPU passthrough is off by default).
                        </span>
                      )}
                    </label>
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold">Kits</h3>
                  <Badge tone="warning">experimental</Badge>
                </div>
                <p className="text-sm text-slate-500">
                  Kits extend this sandbox with credentials, network rules, env vars, and setup commands.
                </p>

                <ExistingKitPicker
                  selectedReferences={kits.map((k) => k.reference)}
                  onSelect={(entry) => addKitReference(entry.reference, entry.sourceType, entry.id)}
                />

                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium text-slate-300">Add a new kit</h4>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => void pickKitFolder()}>
                      Add folder…
                    </Button>
                    <Button variant="secondary" onClick={() => void pickKitZip()}>
                      Add ZIP…
                    </Button>
                    <KitReferenceInput
                      onAdd={(ref) => addKitReference(ref, ref.startsWith('git+') ? 'git' : 'oci')}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {kits.map((k) => (
                    <KitCard
                      key={k.reference}
                      entry={k}
                      onRemove={() => setKits((prev) => prev.filter((x) => x.reference !== k.reference))}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-base font-semibold">Publish ports</h3>
                  <p className="text-sm text-slate-500">Format: [HOST_PORT:]SANDBOX_PORT[/PROTOCOL]</p>
                </div>
                <ListEditor
                  items={ports}
                  draft={portDraft}
                  setDraft={setPortDraft}
                  onAdd={() => {
                    if (portDraft.trim()) {
                      setPorts((p) => [...p, portDraft.trim()])
                      setPortDraft('')
                    }
                  }}
                  onRemove={(i) => setPorts((p) => p.filter((_, idx) => idx !== i))}
                  placeholder="8080 or 3000:8080"
                />

                <div>
                  <h3 className="text-base font-semibold">Deny network (per-sandbox)</h3>
                  <p className="text-sm text-slate-500">Hosts this sandbox is blocked from reaching.</p>
                </div>
                <ListEditor
                  items={denyNetwork}
                  draft={denyDraft}
                  setDraft={setDenyDraft}
                  onAdd={() => {
                    if (denyDraft.trim()) {
                      setDenyNetwork((d) => [...d, denyDraft.trim()])
                      setDenyDraft('')
                    }
                  }}
                  onRemove={(i) => setDenyNetwork((d) => d.filter((_, idx) => idx !== i))}
                  placeholder="evil.example.com"
                />
              </div>
            )}

            {step === 5 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold">Review</h3>
                <Card className="flex flex-col gap-1 text-sm">
                  <div>
                    <span className="text-slate-500">Agent:</span> {agent}
                  </div>
                  <div>
                    <span className="text-slate-500">Name:</span> {name || '(not set)'}
                  </div>
                  <div className="truncate">
                    <span className="text-slate-500">Workspace:</span> {primaryWorkspace ?? '(not set)'}
                  </div>
                  {extraWorkspaces.length > 0 && (
                    <div>
                      <span className="text-slate-500">Extra workspaces:</span>{' '}
                      {extraWorkspaces.map((w) => w.path).join(', ')}
                    </div>
                  )}
                  {memory && (
                    <div>
                      <span className="text-slate-500">Memory:</span> {memory}
                    </div>
                  )}
                  {cpus && (
                    <div>
                      <span className="text-slate-500">CPUs:</span> {cpus}
                    </div>
                  )}
                  {gpuAvailable && gpu && (
                    <div>
                      <span className="text-slate-500">GPU passthrough:</span> enabled
                    </div>
                  )}
                  {kits.length > 0 && (
                    <div>
                      <span className="text-slate-500">Kits:</span> {kits.map((k) => k.reference).join(', ')}
                    </div>
                  )}
                  {ports.length > 0 && (
                    <div>
                      <span className="text-slate-500">Ports:</span> {ports.join(', ')}
                    </div>
                  )}
                  {denyNetwork.length > 0 && (
                    <div>
                      <span className="text-slate-500">Deny network:</span> {denyNetwork.join(', ')}
                    </div>
                  )}
                </Card>
                {createSandbox.isError && (
                  <p className="text-sm text-red-400">{(createSandbox.error as Error).message}</p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-slate-800 p-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <div className="flex gap-2">
              {step > 0 && (
                <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                  Back
                </Button>
              )}
              {step < STEPS.length - 1 && <Button onClick={() => setStep((s) => s + 1)}>Next</Button>}
              {step === STEPS.length - 1 && (
                <Button disabled={!canCreate || createSandbox.isPending} onClick={() => void handleCreate()}>
                  {createSandbox.isPending ? 'Creating…' : 'Create sandbox'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The whole point of the local kit library (see src/main/kitLibrary.ts) is to make kits you've
 * already used trivial to reuse — so the Create wizard should offer them directly instead of
 * making the user re-pick the same folder/ZIP or re-type the same OCI/git reference every time.
 */
function ExistingKitPicker({
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
                  {entry.manifest.manifest.displayName ?? entry.manifest.manifest.name}
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

function KitReferenceInput({ onAdd }: { onAdd: (reference: string) => void }): JSX.Element {
  const [value, setValue] = useState('')
  return (
    <div className="flex flex-1 gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="OCI or git reference (e.g. ghcr.io/org/kit:1.0)"
        className="flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
      />
      <Button
        variant="secondary"
        onClick={() => {
          if (value.trim()) {
            onAdd(value.trim())
            setValue('')
          }
        }}
      >
        Add
      </Button>
    </div>
  )
}

function KitCard({ entry, onRemove }: { entry: KitEntry; onRemove: () => void }): JSX.Element {
  return (
    <Card className="flex min-w-0 flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {entry.details?.manifest.displayName ?? entry.details?.manifest.name ?? entry.reference}
          </div>
          <div className="truncate text-xs text-slate-500">{entry.reference}</div>
        </div>
        <button className="flex-shrink-0 text-xs text-red-400 hover:text-red-300" onClick={onRemove}>
          remove
        </button>
      </div>

      {entry.inspecting && <p className="text-xs text-slate-500">Inspecting…</p>}
      {entry.error && <p className="text-xs text-red-400">{entry.error}</p>}

      {entry.validation && (
        <Badge tone={entry.validation.valid ? 'success' : 'danger'}>
          {entry.validation.valid ? 'valid' : 'invalid'}
        </Badge>
      )}
      {entry.validation && !entry.validation.valid && (
        <p className="text-xs text-red-400">{entry.validation.message}</p>
      )}

      {entry.details && (
        <div className="flex min-w-0 flex-col gap-1 break-words text-xs text-slate-400">
          {entry.details.manifest.description && <p>{entry.details.manifest.description}</p>}
          {entry.details.requires?.agent && <p>Requires agent: {entry.details.requires.agent}</p>}
          {entry.details.credentials && entry.details.credentials.length > 0 && (
            <p>Credentials: {entry.details.credentials.map((c) => c.service).join(', ')}</p>
          )}
          {entry.details.caps?.network?.allow && entry.details.caps.network.allow.length > 0 && (
            <p>Network allow: {entry.details.caps.network.allow.join(', ')}</p>
          )}
          {entry.details.caps?.network?.deny && entry.details.caps.network.deny.length > 0 && (
            <p>Network deny: {entry.details.caps.network.deny.join(', ')}</p>
          )}
          {entry.details.environment?.variables &&
            Object.keys(entry.details.environment.variables).length > 0 && (
              <p>Env vars: {Object.keys(entry.details.environment.variables).join(', ')}</p>
            )}
          {entry.details.commands?.install && entry.details.commands.install.length > 0 && (
            <p>Install steps: {entry.details.commands.install.length}</p>
          )}
          {entry.details.commands?.startup && entry.details.commands.startup.length > 0 && (
            <p>Startup steps: {entry.details.commands.startup.length}</p>
          )}
        </div>
      )}
    </Card>
  )
}

function ListEditor({
  items,
  draft,
  setDraft,
  onAdd,
  onRemove,
  placeholder
}: {
  items: string[]
  draft: string
  setDraft: (v: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  placeholder: string
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
        />
        <Button variant="secondary" onClick={onAdd}>
          Add
        </Button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {items.map((item, i) => (
            <span
              key={`${item}-${i}`}
              className="flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900 px-2 py-0.5 text-xs text-slate-300"
            >
              {item}
              <button className="text-red-400 hover:text-red-300" onClick={() => onRemove(i)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
