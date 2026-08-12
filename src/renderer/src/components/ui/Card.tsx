import type { ReactNode } from 'react'

export function Card({
  children,
  className = '',
  onClick
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}): JSX.Element {
  return (
    <div className={`rounded-lg border border-slate-800 bg-slate-900 p-4 ${className}`} onClick={onClick}>
      {children}
    </div>
  )
}
