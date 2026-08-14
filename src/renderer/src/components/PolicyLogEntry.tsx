export function PolicyLogEntry({
  entry,
  blocked
}: {
  entry: Record<string, unknown>
  blocked?: boolean
}): JSX.Element {
  // Real field names weren't confirmed against populated traffic — render whatever comes back.
  const summary = Object.entries(entry)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
  return (
    <div
      className={`animate-fade-in rounded-md border px-2 py-1 text-xs transition-colors duration-150 ${blocked ? 'border-red-900 text-red-400' : 'border-slate-800 text-slate-400'}`}
    >
      {summary}
    </div>
  )
}
