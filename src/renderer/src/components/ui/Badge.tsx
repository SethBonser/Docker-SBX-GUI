import type { ReactNode } from 'react'

const TONES = {
  neutral: 'bg-slate-800 text-slate-300 border-slate-700',
  success: 'bg-emerald-950 text-emerald-400 border-emerald-800',
  warning: 'bg-amber-950 text-amber-400 border-amber-800',
  danger: 'bg-red-950 text-red-400 border-red-800'
} as const

export function Badge({
  children,
  tone = 'neutral',
  title
}: {
  children: ReactNode
  tone?: keyof typeof TONES
  title?: string
}): JSX.Element {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors duration-150 ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}
