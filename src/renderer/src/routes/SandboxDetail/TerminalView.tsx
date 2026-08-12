import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Button } from '@renderer/components/ui/Button'
import { useTerminalStore } from '@renderer/state/terminalStore'

const THEME = {
  background: '#0f172a', // matches bg-slate-900 container it sits in
  foreground: '#e2e8f0',
  cursor: '#818cf8',
  selectionBackground: '#334155'
}

// Kept mounted for the lifetime of the SandboxDetail page (see SandboxDetail.tsx) so
// switching tabs never tears this down. `active` just controls whether we bother
// re-fitting to the container — a hidden (display:none) element reports zero size, so
// fitting while hidden would otherwise collapse the terminal to 0 cols/rows.
export function TerminalView({ sandboxName, active }: { sandboxName: string; active: boolean }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const appendData = useTerminalStore((s) => s.appendData)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({ theme: THEME, fontSize: 13, cursorBlink: true, scrollback: 5000 })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    termRef.current = term
    fitAddonRef.current = fitAddon

    // Replay whatever scrollback has accumulated (across tab switches and re-navigating
    // to this sandbox) into this fresh terminal instance before live data starts flowing.
    const existingBuffer = useTerminalStore.getState().buffers[sandboxName]
    if (existingBuffer) term.write(existingBuffer)

    const unsubscribe = window.sbxApi.onTerminalData(sandboxName, (data) => {
      term.write(data)
      appendData(sandboxName, data)
    })

    term.onData((data) => {
      void window.sbxApi.sendTerminalInput(sandboxName, data)
    })

    window.sbxApi.startTerminal(sandboxName).catch((err: Error) => {
      term.write(`\r\n\x1b[31mFailed to start terminal: ${err.message}\x1b[0m\r\n`)
    })

    return () => {
      unsubscribe()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxName])

  useEffect(() => {
    if (!active || !fitAddonRef.current || !termRef.current) return
    fitAddonRef.current.fit()
    const { cols, rows } = termRef.current
    void window.sbxApi.resizeTerminal(sandboxName, cols, rows)
  }, [active, sandboxName])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(() => {
      if (!active || !fitAddonRef.current || !termRef.current) return
      fitAddonRef.current.fit()
      const { cols, rows } = termRef.current
      void window.sbxApi.resizeTerminal(sandboxName, cols, rows)
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [active, sandboxName])

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-shrink-0 items-center justify-end">
        <Button
          variant="ghost"
          onClick={() => void window.sbxApi.sendTerminalInput(sandboxName, '/mcp\r')}
        >
          Check /mcp
        </Button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 w-full" />
    </div>
  )
}
