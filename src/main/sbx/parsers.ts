import type { KitDetails, PortMapping, SandboxStatus, SandboxSummary } from '@shared/types'

// Ground-truth shape confirmed against a live `sbx ls --json` (sbx v0.38.0):
// { "sandboxes": [ { name, id, agent, status, ports?: [...], workspaces: [...] } ] }
// The `ports` key is omitted entirely (not `[]`) when no ports are published.
interface RawPort {
  host_ip: string
  host_port: number
  sandbox_port: number
  protocol: string
}

interface RawSandbox {
  name: string
  id: string
  agent: string
  status: string
  ports?: RawPort[]
  workspaces: string[]
}

interface RawLsOutput {
  sandboxes: RawSandbox[]
}

function toSandboxStatus(status: string): SandboxStatus {
  if (status === 'running') return 'running'
  if (status === 'stopped') return 'stopped'
  return 'unknown'
}

function toPortMapping(raw: RawPort): PortMapping {
  return {
    hostIp: raw.host_ip,
    hostPort: raw.host_port,
    sandboxPort: raw.sandbox_port,
    protocol: raw.protocol as PortMapping['protocol']
  }
}

export function parseLsJson(stdout: string): SandboxSummary[] {
  const parsed = JSON.parse(stdout) as RawLsOutput
  return parsed.sandboxes.map((s) => ({
    name: s.name,
    agent: s.agent,
    status: toSandboxStatus(s.status),
    ports: (s.ports ?? []).map(toPortMapping),
    workspace: s.workspaces[0] ?? ''
  }))
}

export function parsePortsJson(stdout: string): PortMapping[] {
  const parsed = JSON.parse(stdout) as RawPort[]
  return parsed.map(toPortMapping)
}

export function parseKitInspectJson(stdout: string): KitDetails {
  return JSON.parse(stdout) as KitDetails
}
