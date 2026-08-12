import { useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { PolicyRuleCard } from '@renderer/components/PolicyRuleCard'
import { PolicyLogEntry } from '@renderer/components/PolicyLogEntry'
import { usePolicyLog, usePolicyRules, useLastAppliedPolicyTier } from '@renderer/state/queries'
import {
  useAllowNetwork,
  useDenyNetwork,
  useInitPolicyTier,
  useRemoveNetworkRule,
  useResetPolicy
} from '@renderer/state/mutations'
import type { PolicyTier } from '@shared/types'

const TIERS: { value: PolicyTier; label: string; description: string }[] = [
  { value: 'allow-all', label: 'Open', description: 'All outbound network traffic is allowed.' },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Typical development traffic is allowed, such as AI services and package registries.'
  },
  { value: 'deny-all', label: 'Locked down', description: 'All outbound network traffic is blocked.' }
]

export function GlobalPolicy(): JSX.Element {
  const rules = usePolicyRules()
  const log = usePolicyLog()
  const allowNetwork = useAllowNetwork()
  const denyNetwork = useDenyNetwork()
  const removeRule = useRemoveNetworkRule()
  const initTier = useInitPolicyTier()
  const resetPolicy = useResetPolicy()
  const lastAppliedTier = useLastAppliedPolicyTier()
  const [draft, setDraft] = useState('')
  const [tierError, setTierError] = useState<string | null>(null)

  async function handleApplyTier(tier: PolicyTier): Promise<void> {
    setTierError(null)
    try {
      await initTier.mutateAsync(tier)
      return
    } catch (err) {
      const message = (err as Error).message
      if (!message.includes('already initialized')) {
        setTierError(message)
        return
      }
    }

    const confirmed = confirm(
      `Switch the global network policy to "${TIERS.find((t) => t.value === tier)?.label}"?\n\n` +
        'This resets ALL policy rules (global and per-sandbox custom rules), restarts the sbx daemon, ' +
        'and stops every currently running sandbox. This cannot be undone.'
    )
    if (!confirmed) return

    try {
      await resetPolicy.mutateAsync()
      await initTier.mutateAsync(tier)
    } catch (err) {
      setTierError((err as Error).message)
    }
  }

  async function handleAdd(decision: 'allow' | 'deny'): Promise<void> {
    const resources = draft.trim()
    if (!resources) return
    if (decision === 'allow') await allowNetwork.mutateAsync(resources)
    else await denyNetwork.mutateAsync(resources)
    setDraft('')
  }

  const applyingTier = initTier.isPending || resetPolicy.isPending

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Policy</h1>
        <p className="mt-1 text-sm text-slate-400">
          Controls what every sandbox can reach on the network, plus custom allow/deny rules.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-300">Network policy tier</h2>
        <p className="mt-1 text-xs text-slate-500">
          Sets the starting global policy. Switching tiers after the first setup resets all rules and
          restarts every sandbox — sbx has no way to change tiers without a full reset. The green outline
          only tracks tiers applied from here — sbx has no way to report which tier is active if it was
          set via the CLI or on first sandbox creation.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {TIERS.map((t) => {
            const isSelected = lastAppliedTier.data === t.value
            return (
              <Card
                key={t.value}
                className={[
                  'flex flex-col gap-2',
                  t.value === 'deny-all' ? 'border-2 border-red-700 bg-red-950/20' : '',
                  isSelected ? 'ring-2 ring-emerald-500' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-200">{t.label}</span>
                  {isSelected && <span className="text-xs font-medium text-emerald-400">Selected</span>}
                </div>
                <span className="flex-1 text-xs text-slate-500">{t.description}</span>
                <Button
                  variant={t.value === 'deny-all' ? 'danger' : 'secondary'}
                  disabled={applyingTier}
                  onClick={() => void handleApplyTier(t.value)}
                >
                  Apply
                </Button>
              </Card>
            )
          })}
        </div>
        {tierError && <p className="mt-2 text-sm text-red-400">{tierError}</p>}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-300">Add a global network rule</h2>
        <p className="mt-1 text-xs text-slate-500">
          Comma-separated hosts/domains, e.g. "api.example.com,*.example.com". Applies to every sandbox.
          Deny always wins over allow.
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

      {rules.data && rules.data.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Global rules</h2>
          <div className="flex flex-col gap-2">
            {rules.data.map((r) => (
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
