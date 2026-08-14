import { useState } from 'react'
import { Badge } from '@renderer/components/ui/Badge'
import { Card } from '@renderer/components/ui/Card'
import type { PolicyRule } from '@shared/types'

export function PolicyRuleCard({ rule, onRemove }: { rule: PolicyRule; onRemove: () => void }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const preview = rule.resources.slice(0, 4)
  const remaining = rule.resources.length - preview.length

  return (
    <Card className="flex animate-fade-in flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={rule.decision === 'deny' ? 'danger' : 'success'}>{rule.decision}</Badge>
          <span className="text-sm text-slate-200">{rule.name}</span>
          <span className="text-xs text-slate-500">{rule.resourceType}</span>
        </div>
        {rule.editable && (
          <button className="text-xs text-red-400 hover:text-red-300" onClick={onRemove}>
            remove
          </button>
        )}
      </div>
      <div className="text-xs text-slate-400">
        {(expanded ? rule.resources : preview).join(', ')}
        {!expanded && remaining > 0 && (
          <button className="ml-1 text-indigo-400 hover:text-indigo-300" onClick={() => setExpanded(true)}>
            +{remaining} more
          </button>
        )}
        {expanded && rule.resources.length > 4 && (
          <button className="ml-1 text-indigo-400 hover:text-indigo-300" onClick={() => setExpanded(false)}>
            show less
          </button>
        )}
      </div>
    </Card>
  )
}
