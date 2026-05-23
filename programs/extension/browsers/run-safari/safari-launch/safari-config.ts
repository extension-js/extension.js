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
  const bundleIdentifier = deriveBundleId(appName)
  const projectLocation = `${extensionDir.replace(/[\\/]+$/, '')}-xcode`

  return {
    extensionDir,
    projectLocation,
    appName,
    bundleIdentifier,
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
