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

/**
 * The single decision about what profile a development run gets. Both the
 * chromium and firefox launchers route through this so the profile contract
 * (`false`, `copyFromProfile`, `keepProfileChanges`, the env switch, explicit
 * paths and the plain ephemeral default) is interpreted in exactly one place.
 *
 * - `system`, the browser's own default profile. No managed directory is
 *                created, seeded or cleaned and no profile launch arg is
 *                emitted. Produced by `profile: false` and by the
 *                EXTENSION_USE_SYSTEM_PROFILE / EXTJS_USE_SYSTEM_PROFILE switch.
 * - `explicit`, a user-provided profile path; launched against exactly that
 *                directory.
 * - `managed`, a directory under `dist/extension-js/profiles/<browser>-profile`
 *                that extension.js owns. Ephemeral by default (marked so it is
 *                reclaimed on browser exit); persistent (`dev`) when
 *                `persistProfile` or `keepProfileChanges` is set, in which case
 *                the marker is withheld so the cleanup hook skips it.
 */
export type ProfileKind = 'system' | 'explicit' | 'managed'

export interface ResolveProfileInput {
  rawProfile?: string | false
  /** Managed-profile base directory: `<distRoot>/extension-js/profiles/<browser>-profile`. */
  managedBaseDir: string
  /** EXTENSION_USE_SYSTEM_PROFILE / EXTJS_USE_SYSTEM_PROFILE resolved to a boolean. */
  useSystemProfile: boolean
  /** `persistProfile` option (stable `dev` directory, never auto-cleaned). */
  persistProfile?: boolean
  /** `keepProfileChanges` option, keep the managed profile and its changes across runs. */
  keepProfileChanges?: boolean
  /** `copyFromProfile` option, seed the managed profile as a copy of this path. */
  copyFromProfile?: string
  // Resolve a relative explicit profile path; each launcher passes its own
  // resolver so this module stays free of launcher-specific path logic.
  resolveExplicit: (trimmedProfile: string) => string
}

export interface ResolvedProfile {
  kind: ProfileKind
  // The directory the browser should be pointed at, or '' for the system kind
  // (no --user-data-dir / --profile emitted).
  profilePath: string
  /** True when the managed profile is persisted (no cleanup on exit). */
  persisted: boolean
  /** Set when `copyFromProfile` seeded this run, for logging/visibility. */
  seededFrom?: string
}

function hasExplicit(
  rawProfile: string | false | undefined
): rawProfile is string {
  return typeof rawProfile === 'string' && rawProfile.trim().length > 0
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
    rawProfile,
    managedBaseDir,
    useSystemProfile,
    persistProfile,
    keepProfileChanges,
    copyFromProfile,
    resolveExplicit
  } = input

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
