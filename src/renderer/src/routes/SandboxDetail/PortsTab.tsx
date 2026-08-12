import { useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { usePorts } from '@renderer/state/queries'
import { usePublishPort, useUnpublishPort } from '@renderer/state/mutations'

export function PortsTab({ sandboxName }: { sandboxName: string }): JSX.Element {
  const ports = usePorts(sandboxName)
  const publishPort = usePublishPort(sandboxName)
  const unpublishPort = useUnpublishPort(sandboxName)
  const [draft, setDraft] = useState('')

  async function handlePublish(): Promise<void> {
    const spec = draft.trim()
    if (!spec) return
    await publishPort.mutateAsync(spec)
    setDraft('')
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div>
        <h2 className="text-sm font-semibold text-slate-300">Published ports</h2>
        <p className="mt-1 text-xs text-slate-500">
          Format: [HOST_PORT:]SANDBOX_PORT[/PROTOCOL] — leave the host port off for an ephemeral one.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handlePublish()}
          placeholder="8080 or 3000:8080"
          className="flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
        />
        <Button disabled={publishPort.isPending || !draft.trim()} onClick={() => void handlePublish()}>
          Publish
        </Button>
      </div>

      {publishPort.isError && (
        <p className="text-sm text-red-400">{(publishPort.error as Error).message}</p>
      )}

      {ports.isLoading && <p className="text-sm text-slate-400">Loading ports…</p>}
      {ports.isError && <p className="text-sm text-red-400">{(ports.error as Error).message}</p>}

      {ports.data && ports.data.length === 0 && (
        <Card>
          <p className="text-sm text-slate-400">No ports published yet.</p>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {ports.data?.map((p, i) => {
          const spec = `${p.hostPort}:${p.sandboxPort}/${p.protocol}`
          return (
            <Card key={`${spec}-${i}`} className="flex items-center justify-between">
              <span className="font-mono text-sm text-slate-200">
                {p.hostIp ?? '127.0.0.1'}:{p.hostPort} → {p.sandboxPort}/{p.protocol}
              </span>
              <Button
                variant="danger"
                disabled={unpublishPort.isPending}
                onClick={() => unpublishPort.mutate(spec)}
              >
                Unpublish
              </Button>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
