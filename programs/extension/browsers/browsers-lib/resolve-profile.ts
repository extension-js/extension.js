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

// A managed profile is a FULL browser profile (Cookies, History, Login Data).
// A '*' .gitignore inside dist/extension-js hides it from git; write-once, best-effort.
export function ensureProfileRootIgnoreFile(managedBaseDir: string): void {
  try {
    const sessionRoot = path.dirname(path.dirname(managedBaseDir))
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

// Copy source into dest recursively, seeding a managed profile from
// copyFromProfile; best-effort no-op when source is missing.
export function seedProfileFrom(source: string, dest: string) {
  if (!fs.existsSync(source)) return

  fs.mkdirSync(dest, {recursive: true})
  // fs.cpSync (Node 16.7+) copies directory trees; used elsewhere in the repo
  // for profile-shaped data, so it is the canonical choice here.
  fs.cpSync(source, dest, {recursive: true})
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
      ...(hasCopyFrom(copyFromProfile) && isFreshTarget
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
    seedProfileFrom(source, profilePath)
    seededFrom = source
  }

  return {kind: 'managed', profilePath, persisted, seededFrom}
}
