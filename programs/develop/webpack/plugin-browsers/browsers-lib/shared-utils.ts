import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net'
import {DEFAULT_DEBUG_PORT, PORT_OFFSET} from './constants'

export function shortInstanceId(instanceId?: string): string {
  return instanceId ? String(instanceId).slice(0, 8) : ''
}

export function instanceOffsetFromId(instanceId?: string): number {
  const short = shortInstanceId(instanceId)
  return short ? parseInt(short, 16) % 1000 | 0 : 0
}

export function deriveDebugPortWithInstance(
  optionPort?: number | string,
  instanceId?: string
) {
  const basePlusOffset = calculateDebugPort(
    optionPort,
    undefined,
    DEFAULT_DEBUG_PORT
  )

  return basePlusOffset + instanceOffsetFromId(instanceId)
}

// Detect Chromium lock files under a profile path
// Profile lock and instance selection helpers removed
// with ephemeral profiles
// Calculates debug port from various sources
export function calculateDebugPort(
  portFromConfig?: number | string,
  devServerPort?: number,
  defaultPort: number = DEFAULT_DEBUG_PORT
) {
  const finalPort = portFromConfig
    ? typeof portFromConfig === 'string'
      ? parseInt(portFromConfig, 10)
      : portFromConfig
    : devServerPort

  return typeof finalPort === 'number' ? finalPort + PORT_OFFSET : defaultPort
}

// Filters browser flags based on exclusions
export function filterBrowserFlags(
  defaultFlags: string[],
  excludeFlags: string[] = []
) {
  return defaultFlags.filter(
    (flag) => !excludeFlags.some((excludeFlag) => flag === excludeFlag)
  )
}

// Find an available TCP port near a starting port.
// Defaults to localhost.
export async function findAvailablePortNear(
  startPort: number,
  maxAttempts: number = 20,
  host: string = '127.0.0.1'
) {
  function tryPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => {
        resolve(false)
      })
      server.once('listening', () => {
        server.close(() => resolve(true))
      })
      server.listen(port, host)
    })
  }

  let candidate = startPort

  for (let i = 0; i < maxAttempts; i++) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await tryPort(candidate)
    if (ok) return candidate
    candidate += 1
  }

  return startPort
}

// Remove old ephemeral temp profile directories (tmp-*)
export function cleanupOldTempProfiles(
  baseDir: string,
  excludeBasename: string | undefined,
  maxAgeHours: number = 12
) {
  try {
    if (!fs.existsSync(baseDir)) return

    const entries = fs.readdirSync(baseDir, {withFileTypes: true})
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const name = entry.name
      if (!name.startsWith('tmp-')) continue

      if (excludeBasename && name === excludeBasename) continue

      const full = path.join(baseDir, name)
      let mtime = 0

      try {
        const st = fs.statSync(full)
        mtime = st.mtimeMs
      } catch {
        // ignore
      }

      if (mtime > 0 && mtime < cutoff) {
        try {
          fs.rmSync(full, {recursive: true, force: true})
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}
