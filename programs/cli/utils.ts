import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import fs from 'node:fs'

function copyIfExists(src: string, dest: string): void {
  try {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest)
    }
  } catch {
    // best-effort only – missing or unreadable config should not break CLI
  }
}

function syncPackageManagerConfig(cacheDir: string): void {
  const cwd = process.cwd()

  // Mirror per-project config so dlx installs (run in a temp dir) still
  // respect the user's registry/auth settings.
  copyIfExists(path.join(cwd, '.npmrc'), path.join(cacheDir, '.npmrc'))
  copyIfExists(
    path.join(cwd, '.pnpmfile.cjs'),
    path.join(cacheDir, '.pnpmfile.cjs')
  )
}

export function resolveModuleEntry(
  modulePath: string,
  pkgJson: any
): string | undefined {
  const exportsField = pkgJson.exports
  let main: string | undefined = pkgJson.main

  // Handle "exports" as a string (Like{ "exports": "./dist/module.js" })
  if (!main && typeof exportsField === 'string') {
    main = exportsField
  }

  // Handle "exports" as an object
  if (!main && exportsField && typeof exportsField === 'object') {
    const dotExport = (exportsField as any)['.']

    if (typeof dotExport === 'string') {
      // Like{ "exports": { ".": "./dist/module.js" } }
      main = dotExport
    } else if (dotExport && typeof dotExport === 'object') {
      // Like{ "exports": { ".": { "import": "./dist/module.js", "require": "./dist/module.cjs" } } }
      main =
        (dotExport as any).import ||
        (dotExport as any).require ||
        (dotExport as any).default ||
        (dotExport as any).node
    }

    // Some packages put fields at the top level of "exports"
    if (!main) {
      const maybe =
        (exportsField as any).import ||
        (exportsField as any).require ||
        (exportsField as any).default ||
        (exportsField as any).node

      if (typeof maybe === 'string') {
        main = maybe
      }
    }
  }

  if (main) {
    return pathToFileURL(path.join(modulePath, main)).href
  }

  // Legacy/common filename fallbacks, in order of preference
  const candidates = [
    path.join(modulePath, 'dist', 'module.js'),
    path.join(modulePath, 'dist', 'index.js'),
    path.join(modulePath, 'index.js')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return pathToFileURL(candidate).href
    }
  }

  return undefined
}

export type Browser =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'chromium'
  | 'chromium-based'
  | 'gecko-based'
  | 'firefox-based'

export function parseOptionalBoolean(value?: string): boolean {
  if (typeof value === 'undefined') return true
  const normalized = String(value).trim().toLowerCase()
  return !['false', '0', 'no', 'off'].includes(normalized)
}

export const vendors = (browser?: Browser | 'all') => {
  const value = (browser ?? 'chromium') as string
  return value === 'all'
    ? ['chrome', 'edge', 'firefox']
    : String(value).split(',')
}

export function validateVendorsOrExit(
  vendorsList: string[],
  onInvalid: (invalid: string, supported: string[]) => void
) {
  const supported = [
    'chrome',
    'edge',
    'firefox',
    'chromium',
    'chromium-based',
    'gecko-based',
    'firefox-based'
  ]
  for (const v of vendorsList) {
    if (!supported.includes(v)) {
      onInvalid(v, supported)
      process.exit(1)
    }
  }
}
