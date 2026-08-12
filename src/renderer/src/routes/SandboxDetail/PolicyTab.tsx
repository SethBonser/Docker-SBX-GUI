import { useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { PolicyRuleCard } from '@renderer/components/PolicyRuleCard'
import { PolicyLogEntry } from '@renderer/components/PolicyLogEntry'
import { usePolicyLog, usePolicyRules } from '@renderer/state/queries'
import { useAllowNetwork, useDenyNetwork, useRemoveNetworkRule } from '@renderer/state/mutations'

export function PolicyTab({ sandboxName }: { sandboxName: string }): JSX.Element {
  const rules = usePolicyRules(sandboxName)
  const log = usePolicyLog(sandboxName)
  const allowNetwork = useAllowNetwork(sandboxName)
  const denyNetwork = useDenyNetwork(sandboxName)
  const removeRule = useRemoveNetworkRule(sandboxName)
  const [draft, setDraft] = useState('')

  const scoped = rules.data?.filter((r) => r.scope === `sandbox:${sandboxName}`) ?? []
  const global = rules.data?.filter((r) => r.scope !== `sandbox:${sandboxName}`) ?? []

  async function handleAdd(decision: 'allow' | 'deny'): Promise<void> {
    const resources = draft.trim()
    if (!resources) return
    if (decision === 'allow') await allowNetwork.mutateAsync(resources)
    else await denyNetwork.mutateAsync(resources)
    setDraft('')
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto">
      <div>
        <h2 className="text-sm font-semibold text-slate-300">Add a network rule for this sandbox</h2>
        <p className="mt-1 text-xs text-slate-500">
          Comma-separated hosts/domains, e.g. "api.example.com,*.example.com". Deny always wins over allow.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="api.example.com"
            className="flex-1 rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-100"
          />
          <Button
            variant="secondary"
            disabled={allowNetwork.isPending || !draft.trim()}
            onClick={() => void handleAdd('allow')}
          >
            Allow
          </Button>
          <Button
            variant="danger"
            disabled={denyNetwork.isPending || !draft.trim()}
            onClick={() => void handleAdd('deny')}
          >
            Deny
          </Button>
        </div>
        {(allowNetwork.isError || denyNetwork.isError) && (
          <p className="mt-1 text-sm text-red-400">
            {((allowNetwork.error ?? denyNetwork.error) as Error).message}
          </p>
        )}
      </div>

      {rules.isLoading && <p className="text-sm text-slate-400">Loading policy…</p>}
      {rules.isError && <p className="text-sm text-red-400">{(rules.error as Error).message}</p>}

      {scoped.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Specific to this sandbox</h2>
          <div className="flex flex-col gap-2">
            {scoped.map((r) => (
              <PolicyRuleCard key={r.id} rule={r} onRemove={() => removeRule.mutate({ id: r.id })} />
            ))}
          </div>
        </div>
      )}

      {global.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Global rules (apply to every sandbox)</h2>
          <div className="flex flex-col gap-2">
            {global.map((r) => (
              <PolicyRuleCard key={r.id} rule={r} onRemove={() => removeRule.mutate({ id: r.id })} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-300">Recent activity</h2>
        {log.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
        {log.data && log.data.allowedHosts.length === 0 && log.data.blockedHosts.length === 0 && (
          <p className="text-sm text-slate-500">No connections logged yet.</p>
        )}
        {log.data && log.data.blockedHosts.length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {log.data.blockedHosts.map((entry, i) => (
              <PolicyLogEntry key={i} entry={entry} blocked />
            ))}
          </div>
        )}
        {log.data && log.data.allowedHosts.length > 0 && (
          <div className="flex flex-col gap-1">
            {log.data.allowedHosts.map((entry, i) => (
              <PolicyLogEntry key={i} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
