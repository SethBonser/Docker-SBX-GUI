import { useState, type ReactElement, type ReactNode } from 'react'

interface CodeElementProps {
  className?: string
  children?: ReactNode
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  return ''
}

/**
 * Overrides react-markdown's <pre> so fenced code blocks get a language label and a copy
 * button, while keeping the real <pre><code> structure (valid HTML, no nested <div> in <pre>).
 */
export function CodeBlock({ children }: { children?: ReactNode }): JSX.Element {
  const codeElement = (Array.isArray(children) ? children[0] : children) as
    | ReactElement<CodeElementProps>
    | undefined
  const codeProps = codeElement?.props ?? {}
  const text = extractText(codeProps.children).replace(/\n$/, '')
  const lang = codeProps.className?.replace('language-', '') || 'text'

  const [copied, setCopied] = useState(false)

  async function handleCopy(): Promise<void> {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="my-2 overflow-hidden rounded-md border border-slate-800 bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-1">
        <span className="text-xs text-slate-500">{lang}</span>
        <button onClick={() => void handleCopy()} className="text-xs text-slate-400 hover:text-slate-200">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm">{children}</pre>
    </div>
  )
}
