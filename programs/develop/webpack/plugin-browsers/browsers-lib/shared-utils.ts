import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net'
import {Compilation} from '@rspack/core'
import {DevOptions} from '../../../develop-lib/config-types'
import * as messages from './messages'
import {
  DEFAULT_DEBUG_PORT,
  PORT_OFFSET,
  PROFILE_DIR_NAME,
  PROFILES_SUBDIR
} from './constants'
import type {InstanceInfo} from './instance-manager'

// Instance helpers
export function shortInstanceId(instanceId?: string): string {
  return instanceId ? String(instanceId).slice(0, 8) : ''
}

export function instanceOffsetFromId(instanceId?: string): number {
  const short = shortInstanceId(instanceId)
  return short ? parseInt(short, 16) % 1000 | 0 : 0
}

// Derive a debug port that includes global offset and per-instance offset
export function deriveDebugPortWithInstance(
  optionPort?: number | string,
  instanceId?: string
): number {
  // calculateDebugPort already adds the global PORT_OFFSET
  const basePlusOffset = calculateDebugPort(
    optionPort,
    undefined,
    DEFAULT_DEBUG_PORT
  )
  return basePlusOffset + instanceOffsetFromId(instanceId)
}

// Validates a profile path exists and is accessible
// Moved from duplicate implementations in both browsers
export function validateProfilePath(
  browser: DevOptions['browser'],
  profilePath: string
): void {
  // Create directory if it doesn't exist
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(profilePath, {recursive: true})
  }

  const stats = fs.statSync(profilePath)
  if (!stats.isDirectory()) {
    throw new Error(messages.pathIsNotDirectoryError(browser, profilePath))
  }

  // Check if we have read/write permissions
  try {
    fs.accessSync(profilePath, fs.constants.R_OK | fs.constants.W_OK)
  } catch (error) {
    throw new Error(messages.pathPermissionError(browser, profilePath))
  }
}

// Gets the default profile path for a browser
// Accepts either a Compilation object or a direct output path string.
// Falls back to process.cwd()/dist if output.path is missing.
export function getDefaultProfilePath(
  compilationOrPath: Compilation | string | undefined,
  browser: DevOptions['browser']
): string {
  let outputPath: string | undefined
  if (typeof compilationOrPath === 'string') {
    outputPath = compilationOrPath
  } else if (
    compilationOrPath &&
    typeof compilationOrPath === 'object' &&
    'options' in compilationOrPath
  ) {
    outputPath = (compilationOrPath as Compilation).options.output?.path
  } else {
    console.warn(
      `[getDefaultProfilePath] Unexpected input, falling back to process.cwd()/dist for browser: ${browser}`
    )
    outputPath = path.resolve(process.cwd(), 'dist')
  }
  if (!outputPath) {
    outputPath = path.resolve(process.cwd(), 'dist')
  }

  // Store profiles inside the output directory, not at the same level as source files
  return path.resolve(
    outputPath,
    PROFILE_DIR_NAME,
    PROFILES_SUBDIR,
    `${browser}-profile`
  )
}

// Creates a profile directory with atomic rename for safety
export function createProfileDirectory(
  browser: DevOptions['browser'],
  profilePath: string,
  createFn: (tempPath: string) => void
): void {
  const tempPath = `${profilePath}.tmp`

  try {
    // Remove existing profile directory if it exists
    if (fs.existsSync(profilePath)) {
      fs.rmSync(profilePath, {recursive: true, force: true})
    }

    // Create temporary directory
    fs.mkdirSync(tempPath, {recursive: true})

    // Execute the browser-specific creation function
    createFn(tempPath)

    // Atomic rename with single retry on transient errors
    try {
      fs.renameSync(tempPath, profilePath)
    } catch (err: any) {
      const code = err?.code || ''
      const msg = String(err?.message || '')
      const isTransient =
        code === 'EACCES' ||
        code === 'ENOTEMPTY' ||
        code === 'EBUSY' ||
        msg.includes('Directory not empty')
      if (isTransient) {
        // Ensure destination is purged then retry once
        try {
          if (fs.existsSync(profilePath)) {
            fs.rmSync(profilePath, {recursive: true, force: true})
          }
        } catch {}
        fs.renameSync(tempPath, profilePath)
      } else {
        throw err
      }
    }
  } catch (error) {
    // Cleanup on failure
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, {recursive: true, force: true})
    }
    throw new Error(messages.profileCreationError(browser, error))
  }
}

// Detect Chromium lock files under a profile path
export function isChromiumProfileLocked(baseProfilePath: string): boolean {
  const lockCandidates = ['SingletonLock', 'SingletonCookie', 'SingletonSocket']
  return lockCandidates.some((file) =>
    fs.existsSync(path.join(baseProfilePath, file))
  )
}

// Detect Firefox lock file under a profile path
export function isFirefoxProfileLocked(baseProfilePath: string): boolean {
  return fs.existsSync(path.join(baseProfilePath, 'parent.lock'))
}

// Decide which instanceId to use based on reuse intent, concurrency and lock state
export function chooseEffectiveInstanceId(
  reuseRequested: boolean | undefined,
  _concurrent: boolean,
  lockPresent: boolean,
  instanceId?: string
): string | undefined {
  const reuse = typeof reuseRequested === 'undefined' ? true : !!reuseRequested
  // Prefer shared profile only when there is no concurrent run and no lock
  const canShare = reuse && !_concurrent && !lockPresent
  return canShare ? undefined : instanceId
}
// Calculates debug port from various sources
export function calculateDebugPort(
  portFromConfig?: number | string,
  devServerPort?: number,
  defaultPort: number = DEFAULT_DEBUG_PORT
): number {
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
): string[] {
  return defaultFlags.filter(
    (flag) => !excludeFlags.some((excludeFlag) => flag === excludeFlag)
  )
}

// Merges preferences with proper type handling
export function mergePreferences(
  basePrefs: Record<string, any>,
  userPrefs: Record<string, any> = {},
  customPrefs: Record<string, any> = {}
): Record<string, any> {
  return {
    ...basePrefs,
    ...userPrefs,
    ...customPrefs
  }
}

// Applies preferences to a profile object
export function applyPreferences(
  profile: any,
  preferences: Record<string, any>
): void {
  Object.keys(preferences).forEach((pref) => {
    profile.setPreference(pref, preferences[pref] as string | number | boolean)
  })
}

// Find an available TCP port near a starting port. Defaults to localhost.
export async function findAvailablePortNear(
  startPort: number,
  maxAttempts: number = 20,
  host: string = '127.0.0.1'
): Promise<number> {
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
