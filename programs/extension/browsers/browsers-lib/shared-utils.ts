// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {DEFAULT_DEBUG_PORT, PORT_OFFSET} from './constants'

const MANAGED_EPHEMERAL_PROFILE_MARKER = '.extension-js-managed-profile'

export function shortInstanceId(instanceId?: string): string {
  return instanceId ? String(instanceId).slice(0, 8) : ''
}

export function instanceOffsetFromId(instanceId?: string): number {
  const short = shortInstanceId(instanceId)
  return short ? (parseInt(short, 16) % 1000) | 0 : 0
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

export function calculateDebugPort(
  portFromConfig?: number | string,
  devServerPort?: number,
  defaultPort: number = DEFAULT_DEBUG_PORT
) {
  // --port 0 means OS-assigned: deriving CDP from it yields an unbindable
  // privileged port; non-positive/NaN ports fall through.
  const parsed =
    typeof portFromConfig === 'string'
      ? parseInt(portFromConfig, 10)
      : portFromConfig
  const finalPort =
    typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
      ? parsed
      : devServerPort

  return typeof finalPort === 'number' && finalPort > 0
    ? finalPort + PORT_OFFSET
    : defaultPort
}

export function filterBrowserFlags(
  defaultFlags: string[],
  excludeFlags: string[] = []
) {
  return defaultFlags.filter(
    (flag) => !excludeFlags.some((excludeFlag) => flag === excludeFlag)
  )
}

export interface ChromiumBinaryChoice {
  binary: string | null
  usedManagedSnapshot: boolean
  swappedToSystem: boolean
}

// A managed chromium install is a tip-of-tree snapshot; prefer a system stable
// browser unless EXTENSION_PREFER_CHROMIUM_SNAPSHOT=true. Cache paths don't count.
export function chooseChromiumBinaryPreferringStable(opts: {
  managedSnapshotBinary: string | null
  systemBinary: string | null
  managedCacheRoot?: string
  preferManagedSnapshot?: boolean
}): ChromiumBinaryChoice {
  const managed = opts.managedSnapshotBinary
  if (!managed) {
    return {binary: null, usedManagedSnapshot: false, swappedToSystem: false}
  }
  if (opts.preferManagedSnapshot) {
    return {binary: managed, usedManagedSnapshot: true, swappedToSystem: false}
  }

  const system = opts.systemBinary
  const cacheRoot = String(opts.managedCacheRoot || '').trim()
  const isCacheLikePath = (p: string) => {
    const normalized = p.replace(/\\/g, '/')
    if (/\/(puppeteer|ms-playwright)\//i.test(normalized)) return true
    if (cacheRoot && normalized.startsWith(cacheRoot.replace(/\\/g, '/'))) {
      return true
    }
    return false
  }

  if (system && system !== managed && !isCacheLikePath(system)) {
    return {binary: system, usedManagedSnapshot: false, swappedToSystem: true}
  }

  return {binary: managed, usedManagedSnapshot: true, swappedToSystem: false}
}

// EXTENSION_BROWSER_FLAGS: launcher-agnostic escape hatch to append flags per
// launch; whitespace-separated, appended AFTER config flags so env wins.
export function parseEnvBrowserFlags(raw: string | undefined | null): string[] {
  return String(raw || '')
    .split(/\s+/)
    .map((flag) => flag.trim())
    .filter(Boolean)
}

// Chromium keeps only the LAST occurrence of a repeated switch; collapse
// --disable/enable-features into one comma-joined switch each.
export function mergeChromiumFeatureSwitches(flags: string[]): string[] {
  const merged: string[] = []
  const featureValues: Record<string, string[]> = {
    '--enable-features=': [],
    '--disable-features=': []
  }

  for (const flag of flags) {
    const prefix = Object.keys(featureValues).find((p) => flag.startsWith(p))
    if (!prefix) {
      merged.push(flag)
      continue
    }
    for (const value of flag.slice(prefix.length).split(',')) {
      const trimmed = value.trim()
      if (trimmed && !featureValues[prefix].includes(trimmed)) {
        featureValues[prefix].push(trimmed)
      }
    }
  }

  for (const [prefix, values] of Object.entries(featureValues)) {
    if (values.length) merged.push(`${prefix}${values.join(',')}`)
  }

  return merged
}

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

function isProcessLikelyAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function parseChromiumSingletonOwner(
  raw: string
): {host: string; pid: number} | null {
  const value = String(raw || '').trim()
  const lastDash = value.lastIndexOf('-')
  if (lastDash <= 0) return null

  const host = value.slice(0, lastDash).trim()
  const pid = parseInt(value.slice(lastDash + 1).trim(), 10)
  if (!host || !Number.isInteger(pid) || pid <= 0) return null

  return {host, pid}
}

function readChromiumSingletonOwner(
  profilePath: string
): {host: string; pid: number} | null {
  const lockPath = path.join(profilePath, 'SingletonLock')
  if (!fs.existsSync(lockPath)) return null

  try {
    const stat = fs.lstatSync(lockPath)
    if (stat.isSymbolicLink()) {
      return parseChromiumSingletonOwner(fs.readlinkSync(lockPath))
    }
  } catch {
    // Ignore
  }

  try {
    return parseChromiumSingletonOwner(fs.readFileSync(lockPath, 'utf8'))
  } catch {
    return null
  }
}

function removeChromiumSingletonArtifacts(profilePath: string): string[] {
  const removed: string[] = []
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const full = path.join(profilePath, name)
    if (!fs.existsSync(full)) continue

    try {
      fs.rmSync(full, {recursive: true, force: true})
      removed.push(name)
    } catch {
      // Ignore
    }
  }
  return removed
}

export function prepareChromiumProfileForLaunch(profilePath: string) {
  const owner = readChromiumSingletonOwner(profilePath)
  if (!owner) return {removedArtifacts: [] as string[]}

  const currentHost = os.hostname().trim().toLowerCase()
  const ownerHost = owner.host.trim().toLowerCase()
  const sameHost = currentHost.length > 0 && currentHost === ownerHost
  const alive = isProcessLikelyAlive(owner.pid)

  if (!sameHost || !alive) {
    return {
      removedArtifacts: removeChromiumSingletonArtifacts(profilePath)
    }
  }

  throw new Error(
    `Chromium profile "${profilePath}" is already in use by process ${owner.pid}` +
      ` on host ${owner.host}. Close that browser session or use a different profile ` +
      `before starting Extension.js.`
  )
}

export function markManagedEphemeralProfile(profilePath: string) {
  try {
    fs.writeFileSync(
      path.join(profilePath, MANAGED_EPHEMERAL_PROFILE_MARKER),
      'managed-ephemeral-profile\n',
      'utf8'
    )
  } catch {
    // Ignore
  }
}

export function removeManagedEphemeralProfile(
  profilePath: string | undefined | null
) {
  try {
    if (!profilePath) return
    if (path.basename(profilePath) === 'dev') return

    const markerPath = path.join(profilePath, MANAGED_EPHEMERAL_PROFILE_MARKER)
    if (!fs.existsSync(markerPath)) return

    fs.rmSync(profilePath, {recursive: true, force: true})
  } catch {
    // best-effort; the 12h sweep on the next launch is the fallback
  }
}

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
      if (name === 'dev') continue

      if (excludeBasename && name === excludeBasename) continue

      const full = path.join(baseDir, name)
      const markerPath = path.join(full, MANAGED_EPHEMERAL_PROFILE_MARKER)
      if (!fs.existsSync(markerPath)) continue

      let mtime = 0

      try {
        const st = fs.statSync(full)
        mtime = st.mtimeMs
      } catch {
        // Ignore
      }

      if (mtime > 0 && mtime < cutoff) {
        try {
          fs.rmSync(full, {recursive: true, force: true})
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Ignore
  }
}
