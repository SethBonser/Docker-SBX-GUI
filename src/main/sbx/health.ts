import { sbxCli } from './sbxCli'
import { SbxCliError } from './errors'
import type { HealthStatus } from '@shared/types'

export async function probeHealth(): Promise<HealthStatus> {
  let version: string | null = null
  let binaryFound = true

  try {
    const v = await sbxCli.version()
    version = v.version
  } catch (err) {
    if (err instanceof SbxCliError && err.kind === 'BinaryNotFound') {
      binaryFound = false
    }
    // Any other error still means the binary exists and ran.
  }

  if (!binaryFound) {
    return { binaryFound: false, version: null, daemonUp: false, loggedIn: false, username: null }
  }

  const daemonStatus = await sbxCli.daemonStatus()
  const daemonUp = daemonStatus === 'running'

  let loggedIn = true
  let username: string | null = null
  if (daemonUp) {
    try {
      await sbxCli.ls()
      // Only call whoami() once we know we're logged in — see sbxCli.whoami() for why.
      username = await sbxCli.whoami()
    } catch (err) {
      if (err instanceof SbxCliError && err.kind === 'NotLoggedIn') {
        loggedIn = false
      }
    }
  }

  return { binaryFound, version, daemonUp, loggedIn, username }
}
