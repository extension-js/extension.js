// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {CompilationLike} from '../../browsers-types'
import type {SafariBuildConfig, SafariPluginLike} from '../safari-types'

function sanitizeAppName(value: string) {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length > 0 ? cleaned : 'Extension'
}

function bundleSegment(appName: string) {
  return (
    String(appName || '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'extension'
  )
}

function deriveBundleId(appName: string) {
  return `dev.extensionjs.${bundleSegment(appName)}`
}

// Apple's rule for CFBundleIdentifier: letters, digits, hyphens and periods.
// A segment may start with a digit (com.1password.ext), none may be empty.
export function isValidBundleId(value: string): boolean {
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/.test(value)
}

function readManifest(extensionDir: string): Record<string, unknown> {
  try {
    const manifestPath = path.join(extensionDir, 'manifest.json')

    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) || {}
    }
  } catch {
    // Ignore
  }

  return {}
}

export function resolveSafariBuildConfig(
  compilation: CompilationLike,
  host: SafariPluginLike
): SafariBuildConfig {
  const extensionDir = String(
    (compilation as {options?: {output?: {path?: unknown}}} | undefined)
      ?.options?.output?.path || ''
  )
  const manifest = readManifest(extensionDir)
  const appName = sanitizeAppName(
    String(host.appName || manifest?.name || 'Extension')
  )
  const userBundleId = String(host.bundleId || '').trim()
  const bundleIdDerived = !userBundleId
  const bundleIdentifier = bundleIdDerived
    ? deriveBundleId(appName)
    : userBundleId
  const projectLocation = `${extensionDir.replace(/[\\/]+$/, '')}-xcode`

  return {
    extensionDir,
    projectLocation,
    appName,
    bundleIdentifier,
    bundleIdDerived,
    macOsOnly: host.macOsOnly !== false,
    language: 'swift',
    // --no-open means open nothing at all: no app raise here, and the dev
    // launcher skips the starting URL too.
    open: !host.noOpen,
    safariBinary: host.safariBinary,
    developmentTeam: String(host.developmentTeam || '').trim() || undefined,
    appIcon: String(host.appIcon || '').trim() || undefined
  }
}

export function composeConverterArgs(config: SafariBuildConfig): string[] {
  const args = [
    'safari-web-extension-converter',
    config.extensionDir,
    '--project-location',
    config.projectLocation,
    '--app-name',
    config.appName,
    '--bundle-identifier',
    config.bundleIdentifier,
    '--no-prompt',
    '--no-open',
    '--force',
    config.language === 'objc' ? '--objc' : '--swift'
  ]
  if (config.macOsOnly) args.push('--macos-only')

  return args
}

export function macOsSchemeName(config: SafariBuildConfig) {
  return config.macOsOnly ? config.appName : `${config.appName} (macOS)`
}

export function xcodeProjectPath(config: SafariBuildConfig) {
  return path.join(
    config.projectLocation,
    config.appName,
    `${config.appName}.xcodeproj`
  )
}

export function derivedDataPath(config: SafariBuildConfig) {
  return path.join(config.projectLocation, '.derived')
}

export function builtAppPath(config: SafariBuildConfig) {
  return path.join(
    derivedDataPath(config),
    'Build',
    'Products',
    'Release',
    `${config.appName}.app`
  )
}

// xcodebuild args. Local builds use ad-hoc signing (identity '-') so the
// embedded .appex still passes ValidateEmbeddedBinary; real signing is a deploy stage.
export function composeXcodebuildArgs(config: SafariBuildConfig): string[] {
  const base = [
    '-project',
    xcodeProjectPath(config),
    '-scheme',
    macOsSchemeName(config),
    '-configuration',
    'Release',
    '-derivedDataPath',
    derivedDataPath(config)
  ]

  // Measured on Safari 26: an ad-hoc app runs only while unsigned extensions
  // are allowed, a team-signed app needs no toggle.
  // Automatic signing lets Xcode mint the profile, and
  // -allowProvisioningUpdates is what permits that without opening Xcode.
  // Trimmed here as well as at config time: this function is exported and a
  // caller that hands it a whitespace team would otherwise get
  // `DEVELOPMENT_TEAM=   `, which xcodebuild accepts and then fails to sign
  // with, hours later, for reasons that point nowhere near this line.
  const team = String(config.developmentTeam || '').trim()

  if (team) {
    return [
      ...base,
      `DEVELOPMENT_TEAM=${team}`,
      'CODE_SIGN_STYLE=Automatic',
      '-allowProvisioningUpdates',
      'build'
    ]
  }

  return [
    ...base,
    'CODE_SIGN_IDENTITY=-',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGNING_ALLOWED=YES',
    'build'
  ]
}

export function manifestFingerprintPath(config: SafariBuildConfig): string {
  return path.join(config.projectLocation, '.manifest-fingerprint')
}

// The dev server writes its HMR chunks to this folder, and the first save is the
// first compile that emits any, so the full package never sees it.
const HOT_UPDATE_DIR = 'hot'

// The generated project references each top-level entry of the build folder by
// name, so adding or removing one is what a regeneration has to catch. The hot
// update folder is dev runtime output, not a project entry: it appears on the
// first save and would regenerate the project once per session for nothing.
function topLevelEntries(extensionDir: string): string[] {
  try {
    return fs
      .readdirSync(extensionDir)
      .filter((entry) => entry !== HOT_UPDATE_DIR)
      .sort()
  } catch {
    return []
  }
}

// The converter builds the app's icon set from the manifest icons, so those
// are the one manifest field a regeneration still has to track.
function iconsFingerprint(extensionDir: string): string {
  try {
    const raw = fs.readFileSync(
      path.join(extensionDir, 'manifest.json'),
      'utf8'
    )
    const icons = (JSON.parse(raw) as {icons?: Record<string, unknown>}).icons
    if (!icons || typeof icons !== 'object') return ''

    return Object.keys(icons)
      .sort()
      .map((size) => `${size}:${String(icons[size])}`)
      .join(',')
  } catch {
    return ''
  }
}

// A supplied app icon replaces the converter's icon set after each conversion,
// so its bytes are a project input: a new file regenerates the project, and
// dropping the option regenerates it back to the converter's own set. The key
// is left out when unset so projects without one keep their fingerprint.
function appIconFingerprint(appIcon: string | undefined): string {
  if (!appIcon) return ''

  try {
    return createHash('sha256').update(fs.readFileSync(appIcon)).digest('hex')
  } catch {
    return 'unreadable'
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

// The converter judges the manifest by its SHAPE: which keys are declared and
// which permissions are asked for. The authoritative list of what it rejects
// lives in extension-develop, one package over, and that package exports no path
// to it, so this tracks the shape itself rather than carrying a second copy of
// the list. A key the converter has an opinion about cannot appear or disappear
// without changing the shape, whatever the list says on any given day.
function judgedManifestSurface(extensionDir: string): string {
  const manifest = readManifest(extensionDir)
  const parts: string[] = [Object.keys(manifest).sort().join(',')]

  // Permissions are judged one string at a time, so this is the one place where
  // values, not key names, are what the verdict turns on.
  for (const listName of ['permissions', 'optional_permissions']) {
    const list = manifest[listName]
    const names = Array.isArray(list)
      ? list
          .filter((entry): entry is string => typeof entry === 'string')
          .sort()
      : []
    parts.push(`${listName}:${names.join(',')}`)
  }

  // Nested keys the converter also judges, by name only. A content script's js
  // path is rewritten to a content-hashed name on every save, and that rename is
  // the edit this whole fingerprint exists to ignore.
  const contentScripts = manifest.content_scripts

  if (Array.isArray(contentScripts)) {
    parts.push(
      contentScripts
        .map((entry) => Object.keys(asRecord(entry)).sort().join('+'))
        .join(';')
    )
  }

  parts.push(Object.keys(asRecord(manifest.options_ui)).sort().join(','))

  return parts.join('|')
}

// v4 fingerprint: identity inputs, the entries the project references, the icon
// set, and the manifest shape the converter judges. The manifest's other bytes
// stay out. Dev rewrites content-script paths to content-hashed names on every
// edit, which made each save look like a new project and re-ran the converter
// for nothing. Older shapes migrate once, since the reader reads any difference
// as stale.
export function composeProjectFingerprint(config: SafariBuildConfig): string {
  return JSON.stringify({
    v: 4,
    identity: {
      appName: config.appName,
      bundleId: config.bundleIdentifier,
      macOsOnly: config.macOsOnly
    },
    entries: topLevelEntries(config.extensionDir),
    icons: iconsFingerprint(config.extensionDir),
    judged: judgedManifestSurface(config.extensionDir),
    ...(config.appIcon ? {appIcon: appIconFingerprint(config.appIcon)} : {})
  })
}

export function saveManifestFingerprint(config: SafariBuildConfig): void {
  fs.mkdirSync(path.dirname(manifestFingerprintPath(config)), {recursive: true})
  fs.writeFileSync(
    manifestFingerprintPath(config),
    composeProjectFingerprint(config),
    'utf8'
  )
}

export function isProjectStale(config: SafariBuildConfig): boolean {
  const fpPath = manifestFingerprintPath(config)
  if (!fs.existsSync(fpPath)) return true

  const stored = fs.readFileSync(fpPath, 'utf8')

  return stored !== composeProjectFingerprint(config)
}

export function buildFingerprintPath(config: SafariBuildConfig): string {
  return path.join(config.projectLocation, '.build-fingerprint')
}

function listBuildFiles(root: string, dir = ''): string[] {
  const out: string[] = []

  for (const entry of fs.readdirSync(path.join(root, dir), {
    withFileTypes: true
  })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name

    if (!dir && entry.name === HOT_UPDATE_DIR) continue

    if (entry.isDirectory()) out.push(...listBuildFiles(root, rel))
    else out.push(rel)
  }

  return out.sort()
}

// What xcodebuild would turn into the app: every byte of the build folder the
// project copies (dev's hot updates aside) and the arguments, signing included.
// A session start with the same fingerprint and the app on disk reuses it.
export function composeBuildFingerprint(
  config: SafariBuildConfig,
  xcodebuildArgs: string[]
): string {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(xcodebuildArgs))

  try {
    for (const rel of listBuildFiles(config.extensionDir)) {
      hash.update(`\0${rel}\0`)
      hash.update(fs.readFileSync(path.join(config.extensionDir, rel)))
    }
  } catch {
    // An unreadable build folder never matches, so the build runs.
    return ''
  }

  return hash.digest('hex')
}

export function saveBuildFingerprint(
  config: SafariBuildConfig,
  fingerprint: string
): void {
  fs.mkdirSync(path.dirname(buildFingerprintPath(config)), {recursive: true})
  fs.writeFileSync(buildFingerprintPath(config), fingerprint, 'utf8')
}

export function isBuildCurrent(
  config: SafariBuildConfig,
  fingerprint: string
): boolean {
  if (!fingerprint || !fs.existsSync(builtAppPath(config))) return false

  try {
    return fs.readFileSync(buildFingerprintPath(config), 'utf8') === fingerprint
  } catch {
    return false
  }
}

// The converter derives the parent app id from the app name, not verbatim from
// --bundle-identifier; rewrite both PRODUCT_BUNDLE_IDENTIFIERs to the configured identity.
export function alignBundleIdentifiers(
  pbxprojContent: string,
  bundleId: string
): string {
  return pbxprojContent.replace(
    /PRODUCT_BUNDLE_IDENTIFIER = ("?)([^;"]+)\1;/g,
    (_match, _quote, value) =>
      /\.Extension$/.test(String(value))
        ? `PRODUCT_BUNDLE_IDENTIFIER = "${bundleId}.Extension";`
        : `PRODUCT_BUNDLE_IDENTIFIER = "${bundleId}";`
  )
}

export const PRESERVED_SETTINGS = [
  'DEVELOPMENT_TEAM',
  'CODE_SIGN_STYLE',
  'PROVISIONING_PROFILE_SPECIFIER'
] as const

export function pbxprojPath(config: SafariBuildConfig): string {
  return path.join(xcodeProjectPath(config), 'project.pbxproj')
}

export function extractXcodeUserSettings(
  pbxprojContent: string
): Record<string, string> {
  const found: Record<string, string> = {}

  for (const key of PRESERVED_SETTINGS) {
    const m = new RegExp(`\\b${key}\\s*=\\s*([^;]+);`).exec(pbxprojContent)

    if (m) {
      const val = m[1].trim()

      if (val && val !== '""' && val !== "''") {
        found[key] = val
      }
    }
  }

  return found
}

export function applyXcodeUserSettings(
  pbxprojContent: string,
  settings: Record<string, string>
): string {
  let result = pbxprojContent

  for (const [key, value] of Object.entries(settings)) {
    const existing = new RegExp(`\\b${key}\\s*=\\s*[^;]+;`, 'g')

    if (existing.test(result)) {
      result = result.replace(existing, `${key} = ${value};`)
    } else {
      result = result.replace(
        /buildSettings\s*=\s*\{/g,
        `buildSettings = {\n\t\t\t\t${key} = ${value};`
      )
    }
  }

  return result
}

export function backupAndRestoreXcodeSettings(config: SafariBuildConfig): {
  saved: Record<string, string>
  restore: () => void
} {
  const projFile = pbxprojPath(config)
  let saved: Record<string, string> = {}

  if (fs.existsSync(projFile)) {
    saved = extractXcodeUserSettings(fs.readFileSync(projFile, 'utf8'))
  }

  return {
    saved,
    restore() {
      if (Object.keys(saved).length === 0) return
      if (!fs.existsSync(projFile)) return

      const content = fs.readFileSync(projFile, 'utf8')
      fs.writeFileSync(projFile, applyXcodeUserSettings(content, saved), 'utf8')
    }
  }
}
