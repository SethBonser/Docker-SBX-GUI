import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { UserBadge } from './UserBadge'
import { ActivityBell } from './ActivityBell'
import { useGlobalActivityListener } from '@renderer/state/notificationStore'
import { useGlobalChatRecorder } from '@renderer/state/chatStore'
import dockerLogo from '@renderer/assets/docker-logo-white.png'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/kits', label: 'Kits' },
  { to: '/secrets', label: 'Secrets' },
  { to: '/mcp', label: 'MCP' },
  { to: '/policy', label: 'Policy' },
  { to: '/settings', label: 'Settings' }
]

/** Chevron pointing the direction the sidebar will move when clicked. */
function CollapseIcon({ pointingLeft }: { pointingLeft: boolean }): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 transition-transform duration-200 ${pointingLeft ? '' : 'rotate-180'}`}
    >
      <path d="M10 3 5 8l5 5" />
    </svg>
  )
}

export function Layout(): JSX.Element {
  const location = useLocation()
  const isSandboxDetail = /^\/sandboxes\//.test(location.pathname)
  const [sidebarHidden, setSidebarHidden] = useState(false)

  useGlobalActivityListener()
  useGlobalChatRecorder()

  // The collapse toggle only makes sense while looking at a sandbox (more room for Chat/
  // Terminal) — leaving that page always restores the sidebar rather than leaving the user
  // stranded on a nav-less screen elsewhere in the app.
  useEffect(() => {
    if (!isSandboxDetail) setSidebarHidden(false)
  }, [isSandboxDetail])

  const collapsed = isSandboxDetail && sidebarHidden

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100">
      <nav
        className={`flex flex-shrink-0 flex-col gap-1 overflow-hidden border-r border-slate-800 transition-all duration-200 ease-out ${
          collapsed ? 'w-0 border-r-0 p-0' : 'w-52 p-3'
        }`}
      >
        <div className="mb-4 flex flex-col gap-1 px-2">
          <img
            src={dockerLogo}
            alt="Docker"
            className="h-5 w-auto shrink-0 self-start aspect-[5000/1072] object-contain"
          />
          <span className="ml-[55px] self-start text-[11px] font-bold uppercase tracking-[0.25em] text-slate-500">
            Sandboxes
          </span>
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors duration-150 ${
                isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2">
          {isSandboxDetail ? (
            <button
              onClick={() => setSidebarHidden((h) => !h)}
              title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
              className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-200"
            >
              <CollapseIcon pointingLeft={!collapsed} />
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <ActivityBell />
            <UserBadge />
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
