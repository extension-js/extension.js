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
import {
  hasPrivateFileName,
  sourceFileMayShip
} from '../../../plugin-special-folders/public-private-files'
import {findPublicFile} from '../../../plugin-special-folders/resolve-public-folder'
import type {DevOptions, FilepathList, Manifest} from '../../../types'

export const isRemoteUrl = (entry: string) =>
  /^([a-z][a-z0-9+.-]*:)?\/\//i.test(entry)

// A manifest path written with a leading slash names the extension root,
// the manifest folder in source space, as the manifest fields resolve it.
export function manifestEntrySourcePath(entry: string, manifestDir: string) {
  return /^[\\/]/.test(entry)
    ? path.join(manifestDir, entry.replace(/^[\\/]+/, ''))
    : entry
}

// The one answer to where a manifest entry is read from, for the check that
// it exists and for the bundler entry alike, so the two cannot disagree.
// The entry is a manifest fields path: absolute, or relative to the manifest.
export function resolveScriptEntryPath(
  entry: string,
  manifestDir: string,
  projectPath: string
) {
  if (!entry || isRemoteUrl(entry)) return entry

  const source = path.isAbsolute(entry) ? entry : path.join(manifestDir, entry)

  if (fs.existsSync(source)) return source

  // public/ ships at the extension root, so a file it holds answers a path
  // that names no source file. The path looked at stays the source one.
  const fromRoot = path.relative(manifestDir, source)

  if (!fromRoot || fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    return source
  }

  return (
    findPublicFile(
      path.join(manifestDir, 'manifest.json'),
      projectPath,
      fromRoot.split(path.sep).join('/')
    ) || source
  )
}

// The files the manifest names apart from the ones the build withholds: a
// withheld file is never an entry, so no step reads it or compiles it. A
// scripts/ file is found by a walk of that folder, which no field names.
export function splitWithheldEntries(
  includeList: FilepathList,
  manifestDir: string,
  projectPath: string
): {kept: FilepathList; withheld: FilepathList} {
  const kept: FilepathList = {}
  const withheld: FilepathList = {}

  const isWithheld = (entry: unknown) => {
    if (typeof entry !== 'string' || !entry || isRemoteUrl(entry)) return false

    const resolved = resolveScriptEntryPath(entry, manifestDir, projectPath)

    return (
      fs.existsSync(resolved) &&
      !sourceFileMayShip(resolved, [projectPath, manifestDir])
    )
  }

  for (const [feature, value] of Object.entries(includeList)) {
    if (feature.startsWith('scripts/')) {
      kept[feature] = value
      continue
    }

    if (Array.isArray(value)) {
      const refused = value.filter(isWithheld)

      kept[feature] = refused.length
        ? value.filter((entry) => !refused.includes(entry))
        : value

      if (refused.length) withheld[feature] = refused

      continue
    }

    if (isWithheld(value)) withheld[feature] = value
    else kept[feature] = value
  }

  return {kept, withheld}
}

// Why the build withholds a file it may not ship: a private name along the
// path as named or where a link leads, or else a place outside the project.
export function withheldEntryKind(
  sourcePath: string,
  projectRoots: string[]
): 'private' | 'outside' {
  const hasPrivateNameBelow = (root: string, file: string) => {
    const fromRoot = path.relative(root, file)

    return (
      fromRoot !== '' &&
      fromRoot !== '..' &&
      !fromRoot.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(fromRoot) &&
      hasPrivateFileName(fromRoot)
    )
  }

  const given = path.resolve(sourcePath)

  if (
    projectRoots.some((root) => hasPrivateNameBelow(path.resolve(root), given))
  ) {
    return 'private'
  }

  try {
    const real = fs.realpathSync(sourcePath)

    if (
      projectRoots.some((root) =>
        hasPrivateNameBelow(fs.realpathSync(root), real)
      )
    ) {
      return 'private'
    }
  } catch {
    // A path that cannot be read through is no private name either.
  }

  return 'outside'
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
    resolveScriptEntryPath(
      manifestEntrySourcePath(entry, manifestDir),
      manifestDir,
      projectPath
    )
  // A file the build withholds is no entry either, like one that is absent.
  const entriesOf = (declared: string[]) =>
    getScriptEntries(
      declared
        .map(resolve)
        .filter((file) => sourceFileMayShip(file, [projectPath, manifestDir]))
    )

  if (background.service_worker) {
    const workerEntries = entriesOf([String(background.service_worker)])
    if (workerEntries.length > 0) return 'background/service_worker'
  }

  const scripts = Array.isArray(background.scripts) ? background.scripts : []
  const scriptEntries = entriesOf(
    scripts.filter((script) => typeof script === 'string')
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
