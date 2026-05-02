// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {devtoolsEngineFor} from './paths'

function hasNewTabOverride(extensionDir: string): boolean {
  const manifestPath = path.join(extensionDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return false

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8')
    const manifest = JSON.parse(raw)
    const newtab = manifest?.chrome_url_overrides?.newtab
    return typeof newtab === 'string' && newtab.trim().length > 0
  } catch {
    // If the manifest cannot be read/parsed, keep loading behavior unchanged.
    return false
  }
}

function resolveBuiltInExtensionForBrowser(input: {
  baseDir: string
  packageName: 'extension-js-devtools' | 'extension-js-theme'
  browser: string
}): string | undefined {
  const engine = devtoolsEngineFor(input.browser as any)
  const packageRelativeCandidates = [
    // Published package / mirrored monorepo output.
    path.join('dist', input.packageName, engine)
  ]

  // Monorepo fallback when watch rebuilds clean programs/develop/dist.
  // Keep this scoped to the known package location to avoid accidental
  // traversal to unrelated ../../extensions folders.
  const normalizedBaseDir = path.normalize(input.baseDir)
  const parentName = path.basename(path.dirname(normalizedBaseDir))
  const baseName = path.basename(normalizedBaseDir)

  if (parentName === 'programs' && baseName === 'develop') {
    packageRelativeCandidates.push(
      path.join('..', '..', 'extensions', input.packageName, 'dist', engine)
    )
  }

  for (const rel of packageRelativeCandidates) {
    const candidate = path.resolve(input.baseDir, rel)
    if (fs.existsSync(candidate)) return candidate
  }

  return undefined
}

// Reserved companion package names. The built-in resolver owns these and
// loads them from a deterministic path. A user-side companion entry that
// shadows one of these would create a second Chrome unpacked-extension entry
// (different path = different ID) and surface as a duplicate in
// chrome://extensions.
const RESERVED_BUILT_IN_NAMES: ReadonlySet<string> = new Set([
  'extension-js-devtools',
  'extension-js-theme'
])

function isReservedBuiltInPath(extensionPath: string): boolean {
  const base = path.basename(path.normalize(extensionPath))
  if (RESERVED_BUILT_IN_NAMES.has(base)) return true

  // Also catch nested layouts like `extensions/extension-js-devtools/dist/<engine>`
  // by checking any segment of the path.
  const segments = path.normalize(extensionPath).split(path.sep)
  return segments.some((segment) => RESERVED_BUILT_IN_NAMES.has(segment))
}

function dedupeByResolvedPath(paths: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of paths) {
    const resolved = path.resolve(entry)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    result.push(entry)
  }
  return result
}

export function computeExtensionsToLoad(
  baseDir: string,
  mode: 'development' | 'production' | 'none' | string | undefined,
  browser: string,
  userExtensionOutputPath: string,
  extraExtensionDirs: string[] = [],
  userManifestPath?: string
): string[] {
  const list: string[] = []
  try {
    const devtoolsForBrowser = resolveBuiltInExtensionForBrowser({
      baseDir,
      packageName: 'extension-js-devtools',
      browser
    })
    const themeForBrowser = resolveBuiltInExtensionForBrowser({
      baseDir,
      packageName: 'extension-js-theme',
      browser
    })

    const userHasNewTabOverride =
      hasNewTabOverride(userExtensionOutputPath) ||
      (typeof userManifestPath === 'string'
        ? hasNewTabOverride(path.dirname(userManifestPath))
        : false)
    const devtoolsHasNewTabOverride = devtoolsForBrowser
      ? hasNewTabOverride(devtoolsForBrowser)
      : false

    // Keep built-in blank NTP only when the user extension does not provide one.
    // This avoids any NTP conflict while preserving a deterministic default page.
    const shouldSkipDevtoolsForNtpConflict =
      userHasNewTabOverride && devtoolsHasNewTabOverride

    // Always load built-in DevTools when available.
    if (devtoolsForBrowser && !shouldSkipDevtoolsForNtpConflict) {
      list.push(devtoolsForBrowser)
    }

    // Always load the theme when available (dev and preview)
    if (themeForBrowser) {
      list.push(themeForBrowser)
    }
  } catch {
    // ignore
  }

  // Add companion extensions (load-only) before the user extension.
  // Skip companions whose path basename matches a reserved built-in package
  // so the user can keep the source folders side-by-side with their project
  // without triggering a second devtools/theme load.
  for (const p of extraExtensionDirs) {
    if (isReservedBuiltInPath(p)) continue
    list.push(p)
  }

  // Always load the user extension last to give it precedence on conflicts
  list.push(userExtensionOutputPath)

  // Final dedupe: a companion config + the user output + the resolved
  // built-in could otherwise emit the same absolute path twice, which
  // makes Chrome render the same unpacked extension twice on launch.
  return dedupeByResolvedPath(list)
}
