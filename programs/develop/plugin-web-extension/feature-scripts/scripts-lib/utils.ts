// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'

export const isRemoteUrl = (entry: string) =>
  /^([a-z][a-z0-9+.-]*:)?\/\//i.test(entry)

// Root-relative paths point at the extension output root (served from
// public/), which maps to the project directory in source space.
export function resolveScriptEntryPath(
  entry: string,
  manifestDir: string,
  projectPath: string
) {
  if (!entry || isRemoteUrl(entry)) return entry
  if (entry.startsWith('/') && !path.isAbsolute(entry)) {
    return path.join(projectPath, entry.slice(1))
  }
  if (path.isAbsolute(entry)) return entry
  return path.join(manifestDir, entry)
}

// The background entry AddScripts will actually create for an MV3 worker
// target, or undefined when none will exist. Chromium runs a Firefox-style
// background.scripts bundle as a worker under the background/scripts entry,
// and a declared file that does not resolve on disk produces no entry at all.
export function getBackgroundWorkerEntryName(options: {
  manifest: Manifest
  browser: DevOptions['browser']
  manifestDir: string
  projectPath?: string
}): 'background/service_worker' | 'background/scripts' | undefined {
  const {manifest, browser, manifestDir} = options

  if (Number(manifest.manifest_version) !== 3) return undefined
  if (isGeckoBasedBrowser(String(browser))) return undefined

  const background = manifest.background as
    | {service_worker?: string; scripts?: string[]}
    | undefined

  if (!background) return undefined

  const projectPath = options.projectPath || manifestDir
  const resolve = (entry: string) =>
    resolveScriptEntryPath(entry, manifestDir, projectPath)

  if (background.service_worker) {
    const workerEntries = getScriptEntries([
      resolve(String(background.service_worker))
    ])
    if (workerEntries.length > 0) return 'background/service_worker'
  }

  const scripts = Array.isArray(background.scripts) ? background.scripts : []
  const scriptEntries = getScriptEntries(
    scripts.filter((script) => typeof script === 'string').map(resolve)
  )
  if (scriptEntries.length > 0) return 'background/scripts'

  return undefined
}

export function getScriptEntries(scriptPath: string | string[] | undefined) {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
      ? [scriptPath]
      : []

  const fileAssets = scriptEntries.filter((scriptAsset) => {
    const validFile = fs.existsSync(scriptAsset)

    // .d.ts files have no runtime code but path.extname reports .ts; exclude them
    // so declaration files are not treated as script entries (swc would fail).
    if (/\.d\.[cm]?ts$/i.test(scriptAsset)) return false

    const assetExtension = path.extname(scriptAsset)

    return (
      validFile &&
      (assetExtension === '.js' ||
        assetExtension === '.cjs' ||
        assetExtension === '.mjs' ||
        assetExtension === '.jsx' ||
        assetExtension === '.mjsx' ||
        assetExtension === '.ts' ||
        assetExtension === '.mts' ||
        assetExtension === '.mtsx' ||
        assetExtension === '.tsx')
    )
  })

  return fileAssets
}

export function getCssEntries(scriptPath: string | string[] | undefined) {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
      ? [scriptPath]
      : []

  const fileAssets = scriptEntries.filter((scriptAsset) => {
    const validFile = fs.existsSync(scriptAsset)

    return (
      validFile &&
      (scriptAsset.endsWith('.css') ||
        scriptAsset.endsWith('.scss') ||
        scriptAsset.endsWith('.sass') ||
        scriptAsset.endsWith('.less'))
    )
  })

  return fileAssets
}
