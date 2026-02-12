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

export function computeExtensionsToLoad(
  baseDir: string,
  mode: 'development' | 'production' | 'none' | string | undefined,
  browser: string,
  userExtensionOutputPath: string,
  extraExtensionDirs: string[] = []
): string[] {
  const list: string[] = []
  try {
    // baseDir is expected to be the @programs/develop package root.
    // This must be stable across:
    // - monorepo source execution (webpack/ lives under package root)
    // - published execution (compiled JS lives under dist/)
    // Dist roots are mirrored by programs/develop build pipeline.
    const engine = devtoolsEngineFor(browser as any)
    const distRoot = path.resolve(baseDir, 'dist')
    const devtoolsRoot = path.join(distRoot, 'extension-js-devtools')
    const themeRoot = path.join(distRoot, 'extension-js-theme')

    const devtoolsForBrowser = path.join(devtoolsRoot, engine)
    const themeForBrowser = path.join(themeRoot, engine)

    // Load DevTools only in non-production (development watch)
    if (
      mode !== 'production' &&
      fs.existsSync(devtoolsForBrowser) &&
      !hasNewTabOverride(devtoolsForBrowser)
    ) {
      list.push(devtoolsForBrowser)
    }

    // Always load the theme when available (dev and preview)
    if (fs.existsSync(themeForBrowser)) {
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
