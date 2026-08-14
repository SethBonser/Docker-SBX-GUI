import type { ButtonHTMLAttributes } from 'react'

const VARIANTS = {
  primary:
    'bg-indigo-600 text-white shadow-sm shadow-indigo-950/40 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 disabled:shadow-none',
  secondary: 'bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:text-slate-500',
  danger: 'bg-red-900 text-red-200 hover:bg-red-800 disabled:text-red-500',
  ghost: 'bg-transparent text-slate-300 hover:bg-slate-900'
} as const

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }): JSX.Element {
  return (
    <button
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 ease-out disabled:cursor-not-allowed disabled:active:scale-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}
