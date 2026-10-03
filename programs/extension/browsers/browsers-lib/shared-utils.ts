// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {execFileSync} from 'node:child_process'
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

// One exclusion semantic for every launcher and every flag layer: exact
// match, or the exclude naming a switch whose value continues with = or ,
// (--enable-features excludes --enable-features=X). Loose prefixes do not
// match, so --foo never cancels --foobar.
export function filterBrowserFlags(
  flags: string[],
  excludeFlags: string[] = []
) {
  return flags.filter(
    (flag) =>
      !excludeFlags.some((excludeFlag) => {
        if (!excludeFlag) return false
        if (flag === excludeFlag) return true

        return (
          flag.startsWith(`${excludeFlag}=`) ||
          flag.startsWith(`${excludeFlag},`)
        )
      })
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

export type BinaryProvenance = 'managed' | 'pinned' | 'system' | 'snapshot'

// The card names every non-default binary a session runs. A silently selected
// cached snapshot or system fallback must never be invisible in dev output.
export function classifyBinaryProvenance(opts: {
  binaryPath: string
  managedCacheRoot: string
  pinnedByFlag?: boolean
  usedManagedSnapshot?: boolean
}): BinaryProvenance {
  if (opts.pinnedByFlag) return 'pinned'
  if (opts.usedManagedSnapshot) return 'snapshot'

  const root = path.resolve(String(opts.managedCacheRoot || '').trim())
  const binary = path.resolve(String(opts.binaryPath || '').trim())
  if (!root || !binary) return 'system'

  const relative = path.relative(root, binary)
  const underManagedRoot =
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)

  return underManagedRoot ? 'managed' : 'system'
}

// EXTENSION_BROWSER_FLAGS: launcher-agnostic escape hatch to append flags per
// launch; whitespace-separated, appended AFTER config flags so env wins.
export function parseEnvBrowserFlags(raw: string | undefined | null): string[] {
  return String(raw || '')
    .split(/\s+/)
    .map((flag) => flag.trim())
    .filter(Boolean)
}

// EXTENSION_HEADLESS=1 is the focus-steal guard for automated sessions: on
// macOS every headed launch activates itself and hijacks the keyboard.
export function isHeadlessGuardRequested(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return /^(1|true)$/i.test(String(env.EXTENSION_HEADLESS || '').trim())
}

// Read off the argv the launch ran, so the guard, EXTENSION_BROWSER_FLAGS and
// a config browserFlags entry all count the same.
export function launchIsHeadless(flags: readonly string[]): boolean {
  return flags.some((flag) => /^--headless(=|$)/.test(String(flag || '')))
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

// Chromium on POSIX writes its lock as a dangling symlink whose target names
// the owner, so a stat that follows the link never sees the lock at all.
function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target, {throwIfNoEntry: false}) || null
  } catch {
    return null
  }
}

function readChromiumSingletonOwner(
  profilePath: string
): {host: string; pid: number} | null {
  const lockPath = path.join(profilePath, 'SingletonLock')
  const stat = lstatOrNull(lockPath)
  if (!stat) return null

  if (stat.isSymbolicLink()) {
    try {
      return parseChromiumSingletonOwner(fs.readlinkSync(lockPath))
    } catch {
      // Ignore
    }
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
    if (!lstatOrNull(full)) continue

    try {
      fs.rmSync(full, {recursive: true, force: true})
      removed.push(name)
    } catch {
      // Ignore
    }
  }

  return removed
}

export const PROFILE_LOCKED_ERROR_CODE = 'profile_locked'

export interface ProfileLockedError extends Error {
  code: string
  profileLockOwner: {host: string; pid: number}
  profileLockPath?: string
}

// Tagged rather than prose-matched: the ready contract stamps this code, and a
// consumer must never have to grep the sentence to recognize the case.
export function isProfileLockedError(
  error: unknown
): error is ProfileLockedError {
  return (
    !!error &&
    (error as {code?: unknown}).code === PROFILE_LOCKED_ERROR_CODE &&
    typeof (error as {message?: unknown}).message === 'string'
  )
}

function readProcessCommand(pid: number): string | null {
  if (process.platform === 'win32') return null

  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    }).trim()
  } catch {
    return null
  }
}

const CHROMIUM_FAMILY_BINARY =
  /chrom(e|ium)|msedge|microsoft edge|brave|opera|vivaldi|yandex|thorium/i

// A pid outlives its process: after a crash or a reboot the number in the
// lock can belong to anything, so the owner has to be a browser on this dir.
function commandHoldsChromiumProfile(
  command: string,
  profilePath: string
): boolean {
  const profilePaths = [profilePath, realpathOrSelf(profilePath)]
  const namesProfile = profilePaths.some((p) => command.includes(p))
  const binary = profilePaths.reduce(
    (text, p) => text.split(p).join(''),
    command
  )

  if (!CHROMIUM_FAMILY_BINARY.test(binary)) return false
  if (namesProfile) return true

  // No flag means the browser's default data dir, and a relative one cannot
  // be resolved from here. Neither proves the lock stale, so both refuse.
  const dataDir = /--user-data-dir=(\S*)/.exec(command)

  return !dataDir || !path.isAbsolute(dataDir[1].replace(/^["']/, ''))
}

function realpathOrSelf(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

export function prepareChromiumProfileForLaunch(
  profilePath: string,
  probe: {readCommand?: (pid: number) => string | null} = {}
) {
  const owner = readChromiumSingletonOwner(profilePath)
  if (!owner) return {removedArtifacts: [] as string[]}

  const currentHost = os.hostname().trim().toLowerCase()
  const ownerHost = owner.host.trim().toLowerCase()
  const sameHost = currentHost.length > 0 && currentHost === ownerHost
  const alive = isProcessLikelyAlive(owner.pid)
  const command =
    sameHost && alive
      ? (probe.readCommand || readProcessCommand)(owner.pid)
      : null
  // An unreadable command line cannot clear the owner, so it still refuses.
  const holdsProfile =
    command === null || commandHoldsChromiumProfile(command, profilePath)

  if (!sameHost || !alive || !holdsProfile) {
    return {
      removedArtifacts: removeChromiumSingletonArtifacts(profilePath)
    }
  }

  const error = new Error(
    `Chromium profile "${profilePath}" is already in use by process ${owner.pid}` +
      ` on host ${owner.host}. Close that browser session or use a different profile ` +
      `before starting Extension.js.`
  ) as ProfileLockedError
  error.code = PROFILE_LOCKED_ERROR_CODE
  error.profileLockOwner = {host: owner.host, pid: owner.pid}
  error.profileLockPath = profilePath

  throw error
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
