// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {stripBom} from './parse-json-safe'
import {devtoolsEngineFor} from './paths'

function hasNewTabOverride(extensionDir: string): boolean {
  const manifestPath = path.join(extensionDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return false

  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8')
    const manifest = JSON.parse(stripBom(raw))
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
  const engine = devtoolsEngineFor(input.browser)
  const packageRelativeCandidates = [
    // Published package / mirrored monorepo output.
    path.join('dist', input.packageName, engine)
  ]

  // Monorepo fallback when watch rebuilds clean programs/develop/dist. Keep
  // scoped to the known package location to avoid unrelated traversal.
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

// Reserved companion package names, owned by the built-in resolver. A user
// companion shadowing one would surface as a duplicate in chrome://extensions.
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

    if (devtoolsForBrowser && !shouldSkipDevtoolsForNtpConflict) {
      list.push(devtoolsForBrowser)
    }

    if (themeForBrowser) {
      list.push(themeForBrowser)
    }
  } catch {}

  // Add companions (load-only) before the user extension; skip paths that
  // shadow a reserved built-in to avoid a second devtools/theme load.
  for (const p of extraExtensionDirs) {
    if (isReservedBuiltInPath(p)) continue
    list.push(p)
  }

  // Always load the user extension last to give it precedence on conflicts
  list.push(userExtensionOutputPath)

  // Final dedupe: companion config + user output + resolved built-in could
  // emit the same absolute path twice, and Chrome renders it twice on launch.
  return dedupeByResolvedPath(list)
}
