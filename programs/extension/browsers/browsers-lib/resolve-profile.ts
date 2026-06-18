// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {
  uniqueNamesGenerator,
  adjectives,
  colors as ucColors,
  animals
} from 'unique-names-generator'
import {markManagedEphemeralProfile} from './shared-utils'

/**
 * The single decision about what profile a development run gets. Both the
 * chromium and firefox launchers route through this so the profile contract
 * (`false`, `copyFromProfile`, `keepProfileChanges`, the env switch, explicit
 * paths and the plain ephemeral default) is interpreted in exactly one place.
 *
 * - `system`   — the browser's own default profile. No managed directory is
 *                created, seeded or cleaned and no profile launch arg is
 *                emitted. Produced by `profile: false` and by the
 *                EXTENSION_USE_SYSTEM_PROFILE / EXTJS_USE_SYSTEM_PROFILE switch.
 * - `explicit` — a user-provided profile path; launched against exactly that
 *                directory.
 * - `managed`  — a directory under `dist/extension-js/profiles/<browser>-profile`
 *                that extension.js owns. Ephemeral by default (marked so it is
 *                reclaimed on browser exit); persistent (`dev`) when
 *                `persistProfile` or `keepProfileChanges` is set, in which case
 *                the marker is withheld so the cleanup hook skips it.
 */
export type ProfileKind = 'system' | 'explicit' | 'managed'

export interface ResolveProfileInput {
  /** The raw `profile` option as supplied by the user. */
  rawProfile?: string | false
  /** Managed-profile base directory: `<distRoot>/extension-js/profiles/<browser>-profile`. */
  managedBaseDir: string
  /** EXTENSION_USE_SYSTEM_PROFILE / EXTJS_USE_SYSTEM_PROFILE resolved to a boolean. */
  useSystemProfile: boolean
  /** `persistProfile` option (stable `dev` directory, never auto-cleaned). */
  persistProfile?: boolean
  /** `keepProfileChanges` option — keep the managed profile and its changes across runs. */
  keepProfileChanges?: boolean
  /** `copyFromProfile` option — seed the managed profile as a copy of this path. */
  copyFromProfile?: string
  /**
   * Resolve a relative explicit profile path. Each launcher passes its own
   * resolver (against the rspack compilation context) so this module stays
   * free of launcher-specific path logic.
   */
  resolveExplicit: (trimmedProfile: string) => string
}

export interface ResolvedProfile {
  kind: ProfileKind
  /**
   * The directory the launcher should point the browser at, or `''` for the
   * system kind (no `--user-data-dir` / `--profile` should be emitted).
   */
  profilePath: string
  /** True when the managed profile is persisted (no cleanup on exit). */
  persisted: boolean
  /** Set when `copyFromProfile` seeded this run, for logging/visibility. */
  seededFrom?: string
}

function hasExplicit(rawProfile: string | false | undefined): rawProfile is string {
  return typeof rawProfile === 'string' && rawProfile.trim().length > 0
}

function hasCopyFrom(copyFromProfile: string | undefined): copyFromProfile is string {
  return typeof copyFromProfile === 'string' && copyFromProfile.trim().length > 0
}

/**
 * Copy the contents of `source` into `dest`, recursively. Used to seed a managed
 * profile from `copyFromProfile`. No-op (best effort) when `source` is missing.
 */
export function seedProfileFrom(source: string, dest: string) {
  if (!fs.existsSync(source)) return
  fs.mkdirSync(dest, {recursive: true})
  // fs.cpSync (Node 16.7+) copies directory trees; used elsewhere in the repo
  // for profile-shaped data, so it is the canonical choice here.
  fs.cpSync(source, dest, {recursive: true})
}

/**
 * Resolve — and materialize on disk — the profile a run gets. Behavior-preserving
 * for the default ephemeral path and explicit paths; adds `false` (system),
 * `copyFromProfile` (seed) and `keepProfileChanges` (persist + skip cleanup).
 */
export function resolveProfileConfig(input: ResolveProfileInput): ResolvedProfile {
  const {
    rawProfile,
    managedBaseDir,
    useSystemProfile,
    persistProfile,
    keepProfileChanges,
    copyFromProfile,
    resolveExplicit
  } = input

  // `profile: false` and the env switch both mean: the browser's own default
  // profile. Nothing is created, seeded or cleaned. An empty or whitespace-only
  // string is NOT false — it falls through to the managed default below.
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

  // Capture freshness BEFORE creating the directory. A target is "fresh" when it
  // does not exist yet or is empty. `copyFromProfile` seeds only a fresh target,
  // so the seed is copy-once: an ephemeral profile (always a new dir) is seeded
  // every run, while a persisted/kept `dev` profile is seeded once on creation
  // and the user's later changes survive subsequent runs instead of being
  // clobbered by a re-seed every launch.
  const isFreshTarget =
    !fs.existsSync(profilePath) || fs.readdirSync(profilePath).length === 0

  fs.mkdirSync(profilePath, {recursive: true})
  if (!persisted) {
    // Only ephemeral, non-kept profiles are reclaimed on browser exit. The
    // marker is what `removeManagedEphemeralProfile` keys off of, so a persisted
    // or kept profile (no marker) survives — that is how `keepProfileChanges`
    // skips cleanup.
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
