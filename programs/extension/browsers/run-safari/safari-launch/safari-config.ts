// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
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

/**
 * Apple bundle identifiers: dot-separated segments of alphanumerics and
 * hyphens, each starting with a letter, at least two segments (reverse-DNS).
 */
export function isValidBundleId(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/.test(value)
}

function readManifest(extensionDir: string): Record<string, any> {
  try {
    const manifestPath = path.join(extensionDir, 'manifest.json')
    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) || {}
    }
  } catch {
    // best-effort; fall through to defaults
  }
  return {}
}

export function resolveSafariBuildConfig(
  compilation: CompilationLike,
  host: SafariPluginLike
): SafariBuildConfig {
  const extensionDir = String((compilation as any)?.options?.output?.path || '')
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
    open: !host.noOpen,
    safariBinary: host.safariBinary
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

/**
 * Arguments passed to `xcodebuild`. Local builds use ad-hoc signing (identity
 * `-`): a Developer ID isn't required, yet the embedded `.appex` still gets a
 * signature so `ValidateEmbeddedBinary` passes. Fully disabling signing leaves
 * the appex unsigned and that validation step fails. Real distribution signing
 * belongs to a separate deployment stage.
 */
export function composeXcodebuildArgs(config: SafariBuildConfig): string[] {
  return [
    '-project',
    xcodeProjectPath(config),
    '-scheme',
    macOsSchemeName(config),
    '-configuration',
    'Release',
    '-derivedDataPath',
    derivedDataPath(config),
    'CODE_SIGN_IDENTITY=-',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGNING_ALLOWED=YES',
    'build'
  ]
}

// ---------------------------------------------------------------------------
// Manifest fingerprinting — detect when the generated Xcode project is stale
// ---------------------------------------------------------------------------

export function manifestFingerprintPath(config: SafariBuildConfig): string {
  return path.join(config.projectLocation, '.manifest-fingerprint')
}

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj)
  if (typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) {
    return `[${obj.map(stableStringify).join(',')}]`
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((obj as Record<string, unknown>)[k])}`).join(',')}}`
}

function readManifestRaw(extensionDir: string): string {
  try {
    return fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8')
  } catch {
    return ''
  }
}

function normalizeManifest(raw: string): string {
  try {
    return stableStringify(JSON.parse(raw))
  } catch {
    return raw
  }
}

/**
 * v2 fingerprint: manifest content PLUS the identity inputs baked into the
 * generated Xcode project (app name, bundle id, platform). An identity change
 * must re-run the converter or the project keeps shipping the old identity.
 * A v1 fingerprint (raw normalized manifest, no JSON envelope) never matches
 * this shape, so old projects regenerate once and migrate automatically.
 */
export function composeProjectFingerprint(config: SafariBuildConfig): string {
  return JSON.stringify({
    v: 2,
    identity: {
      appName: config.appName,
      bundleId: config.bundleIdentifier,
      macOsOnly: config.macOsOnly
    },
    manifest: normalizeManifest(readManifestRaw(config.extensionDir))
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

// ---------------------------------------------------------------------------
// Xcode user-settings preservation across project regeneration
// ---------------------------------------------------------------------------

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
      // Only preserve if the value looks intentionally set (not empty or placeholder)
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
      // Replace all occurrences with the preserved value.
      result = result.replace(existing, `${key} = ${value};`)
    } else {
      // Inject into every buildSettings block.
      result = result.replace(
        /buildSettings\s*=\s*\{/g,
        `buildSettings = {\n\t\t\t\t${key} = ${value};`
      )
    }
  }
  return result
}

export function backupAndRestoreXcodeSettings(
  config: SafariBuildConfig
): {saved: Record<string, string>; restore: () => void} {
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
