import type { ButtonHTMLAttributes } from 'react'

const VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400',
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
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}
