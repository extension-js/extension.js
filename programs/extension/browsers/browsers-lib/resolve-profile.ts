// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  adjectives,
  animals,
  colors as ucColors,
  uniqueNamesGenerator
} from 'unique-names-generator'
import {humanWarn} from '../../helpers/messaging'
import * as messages from './messages'
import {markManagedEphemeralProfile} from './shared-utils'

export type ProfileKind = 'system' | 'explicit' | 'managed'

export interface ResolveProfileInput {
  rawProfile?: string | boolean
  managedBaseDir: string
  useSystemProfile: boolean
  persistProfile?: boolean
  keepProfileChanges?: boolean
  copyFromProfile?: string
  // Resolve a relative explicit profile path; each launcher passes its own
  // resolver so this module stays free of launcher-specific path logic.
  resolveExplicit: (trimmedProfile: string) => string
  // false composes the same decision without creating, marking or seeding
  // the directory, so a dry run can name the profile it would use.
  provision?: boolean
}

export interface ResolvedProfile {
  kind: ProfileKind
  // The directory the browser should be pointed at, or '' for the system kind
  // (no --user-data-dir / --profile emitted).
  profilePath: string
  persisted: boolean
  seededFrom?: string
}

// The env switches that hand a browser its own default profile, in the
// order they are read. Returns the name of the one that is on.
export function systemProfileEnvName(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  for (const name of [
    'EXTENSION_USE_SYSTEM_PROFILE',
    'EXTJS_USE_SYSTEM_PROFILE'
  ]) {
    const value = env[name]

    if (value) {
      return String(value).toLowerCase().trim() === 'true' ? name : undefined
    }
  }

  return undefined
}

function hasExplicit(
  rawProfile: string | false | undefined
): rawProfile is string {
  return typeof rawProfile === 'string' && rawProfile.trim().length > 0
}

export function normalizeProfileOption(
  value: string | boolean | undefined
): string | false | undefined {
  if (value === false) return false
  if (value === true) return undefined

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'false') return false
    if (normalized === 'true') return undefined

    return value
  }

  return undefined
}

function hasCopyFrom(
  copyFromProfile: string | undefined
): copyFromProfile is string {
  return (
    typeof copyFromProfile === 'string' && copyFromProfile.trim().length > 0
  )
}

// The session root every managed profile sits under, as browserProfileRootDir
// builds it: <project>/dist/extension-js/profiles/<browser>-profile.
export function isSessionArtifactsRoot(candidate: string): boolean {
  return (
    path.basename(candidate) === 'extension-js' &&
    path.basename(path.dirname(candidate)) === 'dist'
  )
}

// A managed profile is a FULL browser profile (Cookies, History, Login Data).
// A '*' .gitignore inside dist/extension-js hides it from git; write-once, best-effort.
export function ensureProfileRootIgnoreFile(managedBaseDir: string): void {
  try {
    const sessionRoot = path.dirname(path.dirname(managedBaseDir))

    // Climbing two levels only lands on the session root for the layout above.
    // Anywhere else is a directory we do not own, and a '*' there would hide
    // files nobody asked us to hide.
    if (!isSessionArtifactsRoot(sessionRoot)) return

    const ignoreFile = path.join(sessionRoot, '.gitignore')
    if (fs.existsSync(ignoreFile)) return

    fs.mkdirSync(sessionRoot, {recursive: true})
    fs.writeFileSync(
      ignoreFile,
      '# Extension.js session state: managed browser profiles (cookies, history,\n' +
        '# logins), session logs and machine contracts. Personal data lives here:\n' +
        '# this directory must never be committed or shipped.\n' +
        '*\n'
    )
  } catch {
    // A hygiene guard must never break a browser launch.
  }
}

// A live Chromium's lock, socket and cookie describe that browser's process,
// never the copy, so dragging them along would lock the seeded profile.
const CHROMIUM_SINGLETON_ARTIFACTS = new Set([
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie'
])

// Copy source into dest recursively, seeding a managed profile from
// copyFromProfile; false when the source is missing and nothing was copied.
export function seedProfileFrom(source: string, dest: string): boolean {
  if (!fs.existsSync(source)) return false

  fs.mkdirSync(dest, {recursive: true})
  // fs.cpSync (Node 16.7+) copies directory trees; used elsewhere in the repo
  // for profile-shaped data, so it is the canonical choice here.
  fs.cpSync(source, dest, {
    recursive: true,
    filter: (entry) => !CHROMIUM_SINGLETON_ARTIFACTS.has(path.basename(entry))
  })

  return true
}

// Resolve (and materialize) the profile a run gets: default ephemeral, explicit
// paths, false (system), copyFromProfile (seed), keepProfileChanges (persist).
export function resolveProfileConfig(
  input: ResolveProfileInput
): ResolvedProfile {
  const {
    managedBaseDir,
    useSystemProfile,
    persistProfile,
    keepProfileChanges,
    copyFromProfile,
    resolveExplicit
  } = input
  const provision = input.provision !== false
  const rawProfile = normalizeProfileOption(input.rawProfile)

  // profile: false and the env switch both mean the browser's own default
  // profile; an empty string is NOT false and falls through to the managed default.
  if (rawProfile === false || useSystemProfile) {
    return {kind: 'system', profilePath: '', persisted: false}
  }

  if (hasExplicit(rawProfile)) {
    const profilePath = resolveExplicit(rawProfile.trim())

    return {kind: 'explicit', profilePath, persisted: false}
  }

  // Managed profile under the dist profiles root. Persisted when the caller
  // asked to persist or to keep changes across runs; ephemeral otherwise.
  const persisted = Boolean(persistProfile) || Boolean(keepProfileChanges)

  let profilePath: string

  if (persisted) {
    profilePath = path.join(managedBaseDir, 'dev')
  } else {
    const human = uniqueNamesGenerator({
      dictionaries: [adjectives, ucColors, animals],
      separator: '-',
      length: 3
    })
    profilePath = path.join(managedBaseDir, human)
  }

  // Capture freshness BEFORE creating the directory: copyFromProfile seeds only a
  // fresh target, so persisted profiles seed once and user changes survive.
  const isFreshTarget =
    !fs.existsSync(profilePath) || fs.readdirSync(profilePath).length === 0

  if (!provision) {
    return {
      kind: 'managed',
      profilePath,
      persisted,
      ...(hasCopyFrom(copyFromProfile) &&
      isFreshTarget &&
      fs.existsSync(copyFromProfile.trim())
        ? {seededFrom: copyFromProfile.trim()}
        : {})
    }
  }

  fs.mkdirSync(profilePath, {recursive: true})
  ensureProfileRootIgnoreFile(managedBaseDir)

  if (!persisted) {
    // Only ephemeral, non-kept profiles are reclaimed on exit; the marker is what
    // removeManagedEphemeralProfile keys off, so kept profiles survive.
    markManagedEphemeralProfile(profilePath)
  }

  let seededFrom: string | undefined

  if (hasCopyFrom(copyFromProfile) && isFreshTarget) {
    const source = copyFromProfile.trim()

    if (seedProfileFrom(source, profilePath)) {
      seededFrom = source
    } else {
      humanWarn(messages.copyFromProfileSourceMissing(source))
    }
  }

  return {kind: 'managed', profilePath, persisted, seededFrom}
}
