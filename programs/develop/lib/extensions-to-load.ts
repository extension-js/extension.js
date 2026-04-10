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
  for (const p of extraExtensionDirs) list.push(p)

  // Always load the user extension last to give it precedence on conflicts
  list.push(userExtensionOutputPath)
  return list
}
