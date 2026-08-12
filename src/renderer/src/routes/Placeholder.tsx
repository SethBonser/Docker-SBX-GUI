export function Placeholder({ title }: { title: string }): JSX.Element {
  return (
    <div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-400">Coming in a later milestone.</p>
    </div>
  )
}
