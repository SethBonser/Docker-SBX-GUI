import { create } from 'zustand'

// Cap accumulated scrollback so a long-running session doesn't grow the buffer (and the
// re-feed-into-a-fresh-terminal cost on remount) unbounded.
const MAX_BUFFER_CHARS = 300_000

interface TerminalStoreState {
  buffers: Record<string, string>
  appendData: (sandboxName: string, data: string) => void
  // For when the sandbox itself is gone, not just cleared — confirmed live (same report as
  // chatStore's removeSession): removing a sandbox and creating a new one under the same name
  // showed the old sandbox's terminal scrollback too, since buffers are keyed only by name.
  removeBuffer: (sandboxName: string) => void
}

export const useTerminalStore = create<TerminalStoreState>((set) => ({
  buffers: {},
  appendData: (sandboxName, data) =>
    set((state) => {
      const combined = (state.buffers[sandboxName] ?? '') + data
      const trimmed =
        combined.length > MAX_BUFFER_CHARS ? combined.slice(combined.length - MAX_BUFFER_CHARS) : combined
      return { buffers: { ...state.buffers, [sandboxName]: trimmed } }
    }),
  removeBuffer: (sandboxName) =>
    set((state) => {
      if (!(sandboxName in state.buffers)) return state
      const buffers = { ...state.buffers }
      delete buffers[sandboxName]
      return { buffers }
    })
}))
