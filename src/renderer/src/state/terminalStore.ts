import { create } from 'zustand'

// Cap accumulated scrollback so a long-running session doesn't grow the buffer (and the
// re-feed-into-a-fresh-terminal cost on remount) unbounded.
const MAX_BUFFER_CHARS = 300_000

interface TerminalStoreState {
  buffers: Record<string, string>
  appendData: (sandboxName: string, data: string) => void
}

export const useTerminalStore = create<TerminalStoreState>((set) => ({
  buffers: {},
  appendData: (sandboxName, data) =>
    set((state) => {
      const combined = (state.buffers[sandboxName] ?? '') + data
      const trimmed =
        combined.length > MAX_BUFFER_CHARS ? combined.slice(combined.length - MAX_BUFFER_CHARS) : combined
      return { buffers: { ...state.buffers, [sandboxName]: trimmed } }
    })
}))
