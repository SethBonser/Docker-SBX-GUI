import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useNotificationStore } from '@renderer/state/notificationStore'

/**
 * Rings when any sandbox has unseen Chat/Terminal activity (see notificationStore.ts) and lists
 * which ones on click. Each unread source gets its own separate link (a "Chat" chip and/or a
 * "Terminal" chip, whichever apply) rather than one link per row picking a single "preferred"
 * tab — an earlier version tried to guess which tab to send you to when both were unread by
 * falling back to the saved default view, which sent a user looking for terminal activity to
 * Chat instead because that sandbox also happened to have (unnoticed) unread chat activity.
 * Two precise links per row removes the guessing entirely instead of tuning it.
 */
export function ActivityBell(): JSX.Element {
  const [open, setOpen] = useState(false)
  const chatUnread = useNotificationStore((s) => s.chatUnread)
  const terminalUnread = useNotificationStore((s) => s.terminalUnread)

  const sandboxNames = Array.from(
    new Set([
      ...Object.entries(chatUnread)
        .filter(([, v]) => v)
        .map(([k]) => k),
      ...Object.entries(terminalUnread)
        .filter(([, v]) => v)
        .map(([k]) => k)
    ])
  ).sort()
  const hasAny = sandboxNames.length > 0

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={hasAny ? `Unseen activity: ${sandboxNames.join(', ')}` : 'No unseen activity'}
        className="relative rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-900 hover:text-slate-200"
      >
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <path d="M5 8a5 5 0 0 1 10 0c0 3.5 1.2 4.5 1.2 4.5H3.8S5 11.5 5 8Z" />
          <path d="M8.3 15a1.8 1.8 0 0 0 3.4 0" />
        </svg>
        {hasAny && (
          <span className="absolute right-1 top-1 h-2 w-2 animate-pulse rounded-full bg-amber-400" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-md border border-slate-800 bg-slate-900 p-2 shadow-lg">
            <div className="px-2 py-1 text-xs text-slate-500">
              {hasAny ? 'Unseen activity' : 'No unseen activity'}
            </div>

            {sandboxNames.map((name) => {
              const chat = chatUnread[name]
              const terminal = terminalUnread[name]
              return (
                <div key={name} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
                  <span className="truncate text-sm text-slate-200">{name}</span>
                  <span className="flex flex-shrink-0 gap-1">
                    {chat && (
                      <Link
                        to={`/sandboxes/${name}?tab=chat`}
                        onClick={() => setOpen(false)}
                        className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-amber-400 transition-colors hover:bg-slate-700"
                      >
                        chat
                      </Link>
                    )}
                    {terminal && (
                      <Link
                        to={`/sandboxes/${name}?tab=terminal`}
                        onClick={() => setOpen(false)}
                        className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-amber-400 transition-colors hover:bg-slate-700"
                      >
                        terminal
                      </Link>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
