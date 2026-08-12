import { NavLink, Outlet } from 'react-router-dom'
import { UserBadge } from './UserBadge'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/kits', label: 'Kits' },
  { to: '/secrets', label: 'Secrets' },
  { to: '/mcp', label: 'MCP' },
  { to: '/policy', label: 'Policy' },
  { to: '/settings', label: 'Settings' }
]

export function Layout(): JSX.Element {
  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-100">
      <nav className="flex w-52 flex-shrink-0 flex-col gap-1 border-r border-slate-800 p-3">
        <div className="mb-3 px-2 text-sm font-semibold text-slate-400">Docker Sandbox GUI</div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded-md px-2 py-1.5 text-sm ${
                isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center justify-end border-b border-slate-800 px-4 py-2">
          <UserBadge />
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
