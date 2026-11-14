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
import {humanLine, humanWarn} from '../../helpers/messaging'
import * as messages from './messages'
import {isInsidePath, realPath} from './real-path'
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
  // The project root, so an explicit profile under it gets the ignore file
  // and README the managed root gets, and one line that says what it holds.
  projectDir?: string
  browser?: string
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

export const EXPLICIT_PROFILE_IGNORE_CONTENT =
  '# Extension.js browser profile (cookies, history, logins), configured by\n' +
  '# browser.<name>.profile in extension.config.js. Personal data lives here:\n' +
  '# this directory must never be committed or shipped.\n' +
  '*\n'

export function explicitProfileReadmeContent(
  browser: string,
  relativePath: string
): string {
  return (
    `# ${relativePath}\n\n` +
    `Extension.js writes this folder: the ${browser} profile that \`browser.${browser}.profile\`\n` +
    'in extension.config.js points at. It holds cookies, history and logins and is\n' +
    'kept between runs. It is not a browser build, is never zipped or published,\n' +
    'and is safe to delete while no session is running.\n'
  )
}

const PROJECT_MARKERS = ['package.json', 'manifest.json', 'extension.config.js']

// A configured path that is the project itself, holds it, or holds a project
// file is not a folder a '*' ignore file may land in.
function isProfileFolderOfProject(
  profilePath: string,
  projectDir: string
): boolean {
  if (!isInsidePath(projectDir, profilePath)) return false

  const relative = path.relative(realPath(projectDir), realPath(profilePath))

  if (relative.split(path.sep).includes('node_modules')) return false

  try {
    if (fs.existsSync(profilePath) && !fs.statSync(profilePath).isDirectory()) {
      return false
    }

    return !PROJECT_MARKERS.some((marker) =>
      fs.existsSync(path.join(profilePath, marker))
    )
  } catch {
    return false
  }
}

const notedExplicitProfiles = new Set<string>()

// Tests resolve the same path more than once in one process.
export function resetExplicitProfileNotes(): void {
  notedExplicitProfiles.clear()
}

// The managed root under dist/extension-js/ gets a '*' ignore file and a
// README; a profile the config points at under the project gets the same,
// inside the profile folder, where it hides the profile and nothing else.
export function ensureExplicitProfileHygiene(
  profilePath: string,
  projectDir: string,
  browser: string
): {ignoreFile: string; readme: string} | null {
  try {
    if (!isProfileFolderOfProject(profilePath, projectDir)) return null

    fs.mkdirSync(profilePath, {recursive: true})

    const ignoreFile = path.join(profilePath, '.gitignore')
    const readme = path.join(profilePath, 'README.md')
    const relative = path
      .relative(path.resolve(projectDir), profilePath)
      .split(path.sep)
      .join('/')

    if (!fs.existsSync(ignoreFile)) {
      fs.writeFileSync(ignoreFile, EXPLICIT_PROFILE_IGNORE_CONTENT)
    }

    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, explicitProfileReadmeContent(browser, relative))
    }

    if (!notedExplicitProfiles.has(profilePath)) {
      notedExplicitProfiles.add(profilePath)
      humanLine(
        messages.explicitProfileUnderProject(
          browser,
          relative,
          relative === 'dist' || relative.startsWith('dist/')
        )
      )
    }

    return {ignoreFile, readme}
  } catch {
    // A hygiene guard must never break a browser launch.
    return null
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

    if (provision && input.projectDir) {
      ensureExplicitProfileHygiene(
        profilePath,
        input.projectDir,
        String(input.browser || 'chrome')
      )
    }

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
