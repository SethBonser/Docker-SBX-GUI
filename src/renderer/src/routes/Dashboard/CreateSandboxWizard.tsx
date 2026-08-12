import { useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { Badge } from '@renderer/components/ui/Badge'
import { Card } from '@renderer/components/ui/Card'
import { useCreateSandbox } from '@renderer/state/mutations'
import type { AgentType, KitDetails, KitValidationResult } from '@shared/types'

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
  inspecting: boolean
  details?: KitDetails
  validation?: KitValidationResult
  error?: string
}

export function CreateSandboxWizard({ onClose }: { onClose: () => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const [agent, setAgent] = useState<AgentType>('claude')
  const [primaryWorkspace, setPrimaryWorkspace] = useState<string | null>(null)
  const [extraWorkspaces, setExtraWorkspaces] = useState<ExtraWorkspace[]>([])
  const [name, setName] = useState('')
  const [memory, setMemory] = useState('')
  const [cpus, setCpus] = useState('')
  const [kits, setKits] = useState<KitEntry[]>([])
  const [ports, setPorts] = useState<string[]>([])
  const [portDraft, setPortDraft] = useState('')
  const [denyNetwork, setDenyNetwork] = useState<string[]>([])
  const [denyDraft, setDenyDraft] = useState('')

  const createSandbox = useCreateSandbox()

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

  function addKitReference(reference: string): void {
    if (!reference || kits.some((k) => k.reference === reference)) return
    setKits((prev) => [...prev, { reference, inspecting: true }])
    void inspectAndValidateKit(reference)
  }

  async function pickKitFolderOrZip(): Promise<void> {
    const picked = await window.sbxApi.pickKitReference()
    if (picked) addKitReference(picked)
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
    await createSandbox.mutateAsync({
      agent,
      name: name.trim(),
      workspaces,
      memory: memory.trim() || undefined,
      cpus: cpus.trim() ? Number(cpus.trim()) : undefined,
      publish: ports.length ? ports : undefined,
      denyNetwork: denyNetwork.length ? denyNetwork : undefined,
      kits: kits.length ? kits.map((k) => k.reference) : undefined
    })
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

        <div className="flex flex-1 flex-col">
          <div className="flex-1 overflow-auto p-6">
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
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => void pickKitFolderOrZip()}>
                    Add folder or ZIP…
                  </Button>
                  <KitReferenceInput onAdd={addKitReference} />
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
    <Card className="flex flex-col gap-2">
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
        <div className="flex flex-col gap-1 text-xs text-slate-400">
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
