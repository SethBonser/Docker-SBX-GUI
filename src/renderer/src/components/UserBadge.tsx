import { useState } from 'react'
import { useDefaultPermissionMode, useDefaultView, useHealth } from '@renderer/state/queries'
import { useSetDefaultPermissionMode, useSetDefaultView } from '@renderer/state/mutations'
import { PERMISSION_MODE_OPTIONS } from '@renderer/permissionModes'
import { useQueryClient } from '@tanstack/react-query'
import type { ClaudePermissionMode, DefaultView } from '@shared/types'

const DOCKER_HUB_URL = 'https://hub.docker.com'
const SBX_DOCS_URL = 'https://docs.docker.com/ai/sandboxes/'

export function UserBadge(): JSX.Element {
  const health = useHealth()
  const defaultView = useDefaultView()
  const setDefaultView = useSetDefaultView()
  const defaultPermissionMode = useDefaultPermissionMode()
  const setDefaultPermissionMode = useSetDefaultPermissionMode()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const username = health.data?.username ?? null
  const initial = username ? username.charAt(0).toUpperCase() : '?'
  const busy = signingIn || signingOut

  async function handleSignIn(): Promise<void> {
    setSigningIn(true)
    try {
      await window.sbxApi.login()
      await queryClient.invalidateQueries({ queryKey: ['health'] })
    } finally {
      setSigningIn(false)
    }
  }

  async function handleSignOut(): Promise<void> {
    if (!confirm('Sign out of Docker? This stops every running sandbox.')) return
    setSigningOut(true)
    try {
      await window.sbxApi.logout()
      await queryClient.invalidateQueries({ queryKey: ['health'] })
      await queryClient.invalidateQueries({ queryKey: ['sandboxes'] })
      setOpen(false)
    } finally {
      setSigningOut(false)
    }
  }

  function openLink(url: string): void {
    void window.sbxApi.openExternal(url)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={username ? `Signed in as ${username}` : 'Not signed in'}
        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
          username ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'
        }`}
      >
        {initial}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-md border border-slate-800 bg-slate-900 p-2 shadow-lg">
            <div className="px-2 py-1 text-xs text-slate-500">
              {username ? (
                <>
                  Signed in as <span className="text-slate-300">{username}</span>
                </>
              ) : (
                'Not signed in to Docker'
              )}
            </div>

            {!username && (
              <button
                disabled={busy}
                onClick={() => void handleSignIn()}
                className="mt-1 w-full rounded-md bg-indigo-600 px-2 py-1.5 text-left text-sm text-white hover:bg-indigo-500 disabled:bg-indigo-900"
              >
                {signingIn ? 'Waiting for browser sign-in…' : 'Sign in to Docker'}
              </button>
            )}

            {username && (
              <button
                disabled={busy}
                onClick={() => void handleSignOut()}
                className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-sm text-red-400 hover:bg-red-950 disabled:text-red-800"
              >
                {signingOut ? 'Signing out…' : 'Log out'}
              </button>
            )}

            <div className="my-2 border-t border-slate-800" />

            <div className="px-2 py-1 text-xs text-slate-500">Default sandbox view</div>
            <div className="flex gap-1 px-2 pb-1">
              {(['chat', 'terminal'] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setDefaultView.mutate(view as DefaultView)}
                  className={`flex-1 rounded-md px-2 py-1 text-xs capitalize ${
                    defaultView.data === view
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {view}
                </button>
              ))}
            </div>

            <div className="px-2 py-1 text-xs text-slate-500">Default chat permissions</div>
            <div className="px-2 pb-1">
              <select
                value={defaultPermissionMode.data ?? 'default'}
                onChange={(e) =>
                  setDefaultPermissionMode.mutate(e.target.value as ClaudePermissionMode)
                }
                className="w-full rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-xs text-slate-300"
              >
                {PERMISSION_MODE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="my-2 border-t border-slate-800" />

            <button
              onClick={() => openLink(DOCKER_HUB_URL)}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800"
            >
              Docker Hub
            </button>
            <button
              onClick={() => openLink(SBX_DOCS_URL)}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-slate-800"
            >
              Sandboxes documentation
            </button>
          </div>
        </>
      )}
    </div>
  )
}
