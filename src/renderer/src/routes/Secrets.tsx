import { useState } from 'react'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { usePasswordManagers, useSandboxes, useSecrets } from '@renderer/state/queries'
import {
  useRemoveSecret,
  useSetSecret,
  useSetSecretFromPasswordManager,
  useSetSecretOAuth
} from '@renderer/state/mutations'
import { SECRET_SERVICES, type PasswordManagerId, type SecretEntry, type SecretService } from '@shared/types'

const inputClass =
  'rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-600'

function ServiceCard({ service, entries }: { service: SecretService; entries: SecretEntry[] }): JSX.Element {
  const sandboxes = useSandboxes()
  const passwordManagers = usePasswordManagers()
  const setSecret = useSetSecret()
  const setSecretOAuth = useSetSecretOAuth()
  const setSecretFromPasswordManager = useSetSecretFromPasswordManager()
  const removeSecret = useRemoveSecret()
  const [value, setValue] = useState('')
  const [scope, setScope] = useState('')
  const [claudeLoginSandbox, setClaudeLoginSandbox] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [pmManagerId, setPmManagerId] = useState<PasswordManagerId | ''>('')
  const [pmReference, setPmReference] = useState('')

  const supportsOAuth = service === 'openai'
  const isAnthropic = service === 'anthropic'
  const availableManagers = (passwordManagers.data ?? []).filter((m) => m.available)

  async function handleSave(): Promise<void> {
    if (!value.trim()) return
    await setSecret.mutateAsync({ service, value: value.trim(), sandboxName: scope || undefined })
    setValue('')
  }

  async function handleFetchFromPasswordManager(): Promise<void> {
    if (!pmManagerId || !pmReference.trim()) return
    await setSecretFromPasswordManager.mutateAsync({
      service,
      managerId: pmManagerId,
      reference: pmReference.trim(),
      sandboxName: scope || undefined
    })
    setPmReference('')
  }

  async function handleClaudeLogin(): Promise<void> {
    if (!claudeLoginSandbox) return
    setSigningIn(true)
    setLoginError(null)
    try {
      const result = await window.sbxApi.loginClaude(claudeLoginSandbox)
      if (!result.success) setLoginError(result.message)
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <Card className="flex animate-fade-in flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">{service}</span>
        {entries.length === 0 && <Badge tone="neutral">not configured</Badge>}
      </div>

      {entries.length > 0 && (
        <div className="flex flex-col gap-1">
          {entries.map((e) => (
            <div key={e.scope} className="flex items-center justify-between text-xs">
              <span className="text-slate-400">
                <Badge tone="success">{e.scope}</Badge> {e.status.replace(/[()]/g, '')}
              </span>
              <button
                className="text-red-400 hover:text-red-300"
                onClick={() =>
                  removeSecret.mutate({
                    service,
                    sandboxName: e.scope === '(global)' ? undefined : e.scope
                  })
                }
                disabled={removeSecret.isPending}
              >
                remove
              </button>
            </div>
          ))}
        </div>
      )}

      {isAnthropic && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
          <select
            value={claudeLoginSandbox}
            onChange={(e) => setClaudeLoginSandbox(e.target.value)}
            className={inputClass}
          >
            <option value="">Sign in via sandbox…</option>
            {sandboxes.data?.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={!claudeLoginSandbox || signingIn}
            onClick={() => void handleClaudeLogin()}
          >
            {signingIn ? 'Waiting for browser…' : 'Sign in with Claude'}
          </Button>
          <span className="text-xs text-slate-500">Always global — Anthropic OAuth can't be scoped to one sandbox.</span>
        </div>
      )}
      {loginError && <p className="text-xs text-red-400">{loginError}</p>}

      {supportsOAuth && (
        <div className="flex items-center gap-2 border-t border-slate-800 pt-2">
          <Button
            variant="secondary"
            disabled={setSecretOAuth.isPending}
            onClick={() => setSecretOAuth.mutate(service)}
          >
            {setSecretOAuth.isPending ? 'Waiting for browser…' : 'Sign in with OAuth'}
          </Button>
          <span className="text-xs text-slate-500">Always global.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste API key"
          className={`flex-1 ${inputClass}`}
        />
        <select value={scope} onChange={(e) => setScope(e.target.value)} className={inputClass}>
          <option value="">Global</option>
          {sandboxes.data?.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <Button disabled={!value.trim() || setSecret.isPending} onClick={() => void handleSave()}>
          Save
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
        <select
          value={pmManagerId}
          onChange={(e) => setPmManagerId(e.target.value as PasswordManagerId | '')}
          className={inputClass}
          disabled={availableManagers.length === 0}
        >
          <option value="">
            {availableManagers.length === 0 ? 'No password manager CLI detected' : 'From password manager…'}
          </option>
          {(passwordManagers.data ?? []).map((m) => (
            <option key={m.id} value={m.id} disabled={!m.available}>
              {m.label}
              {!m.available ? ' (not installed)' : m.signedIn === false ? ' (not signed in)' : ''}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={pmReference}
          onChange={(e) => setPmReference(e.target.value)}
          placeholder={
            pmManagerId === 'op'
              ? 'op://Vault/Item/field'
              : pmManagerId === 'bw'
                ? 'Item name or ID'
                : 'Secret reference'
          }
          disabled={!pmManagerId}
          className={`flex-1 ${inputClass}`}
        />
        <Button
          variant="secondary"
          disabled={!pmManagerId || !pmReference.trim() || setSecretFromPasswordManager.isPending}
          onClick={() => void handleFetchFromPasswordManager()}
        >
          {setSecretFromPasswordManager.isPending ? 'Fetching…' : 'Fetch & Save'}
        </Button>
      </div>
      {pmManagerId && passwordManagers.data?.find((m) => m.id === pmManagerId)?.detail && (
        <p className="text-xs text-amber-400">
          {passwordManagers.data.find((m) => m.id === pmManagerId)?.detail}
        </p>
      )}

      {(setSecret.isError || setSecretOAuth.isError || setSecretFromPasswordManager.isError) && (
        <p className="text-xs text-red-400">
          {
            (
              (setSecret.error ?? setSecretOAuth.error ?? setSecretFromPasswordManager.error) as Error
            ).message
          }
        </p>
      )}
    </Card>
  )
}

export function Secrets(): JSX.Element {
  const secrets = useSecrets()

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Secrets</h1>
        <p className="mt-1 text-sm text-slate-400">
          API keys and OAuth tokens agents use to authenticate — global by default, or scoped to
          one sandbox. Values are stored by <code>sbx</code>'s own OS-keychain-backed secret
          store, never by this app.
        </p>
      </div>

      {secrets.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {secrets.isError && <p className="text-sm text-red-400">{(secrets.error as Error).message}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECRET_SERVICES.map((service) => (
          <ServiceCard
            key={service}
            service={service}
            entries={(secrets.data ?? []).filter((e) => e.name === service && e.type === 'service')}
          />
        ))}
      </div>
    </div>
  )
}
