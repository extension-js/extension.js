// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, type Compiler, WebpackError} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'
import * as messages from '../messages'
import {scannableSourcePath} from './apply-dev-defaults-lib/dev-injected-hosts'

export type GeckoUnsupportedApi = 'sidePanel' | 'action'

export interface GeckoUnsupportedApiUse {
  api: GeckoUnsupportedApi
  // An absolute source path, or the emitted asset name when no project
  // source explains the call (a vendor bundle, for instance).
  file: string
  emitted: boolean
}

// The namespaces addons-linter reports as UNSUPPORTED_API on a Gecko build.
// sidePanel has no Firefox counterpart on any manifest version. action is
// Manifest V3 only, so a Manifest V2 Firefox bundle still needs browserAction.
export function geckoUnsupportedApis(
  manifestVersion: unknown
): GeckoUnsupportedApi[] {
  return manifestVersion === 2 ? ['sidePanel', 'action'] : ['sidePanel']
}

// A static member read on the namespace is what addons-linter matches, so a
// runtime guard around the same call still trips it and must still warn.
export function usesGeckoUnsupportedApi(
  source: string,
  api: GeckoUnsupportedApi
): boolean {
  const memberRe = new RegExp(
    `\\b(?:chrome|browser)\\s*\\.\\s*${api}\\s*\\??\\.\\s*[A-Za-z_$]`
  )
  return memberRe.test(source)
}

interface ScannableModule {
  resource?: string
  modules?: Iterable<ScannableModule>
  rootModule?: ScannableModule
}

interface ScannableChunk {
  files?: Iterable<string>
}

export interface ScannableCompilation {
  modules: Iterable<ScannableModule>
  getAssets?: () => readonly {
    name: string
    source: {source(): string | Buffer}
  }[]
  chunkGraph?: {
    getModuleChunksIterable(module: ScannableModule): Iterable<ScannableChunk>
  }
}

const EMITTED_SCRIPT_RE = /\.[cm]?js$/
const MAX_SOURCE_BYTES = 1024 * 1024
const MAX_ASSET_BYTES = 16 * 1024 * 1024

function readEmittedScripts(
  compilation: ScannableCompilation
): Map<string, string> {
  const scripts = new Map<string, string>()
  let assets: ReturnType<NonNullable<ScannableCompilation['getAssets']>>
  try {
    assets = compilation.getAssets?.() || []
  } catch {
    return scripts
  }
  for (const asset of assets) {
    if (!EMITTED_SCRIPT_RE.test(asset.name)) continue
    try {
      const raw = asset.source.source()
      const text = typeof raw === 'string' ? raw : raw.toString('utf-8')
      if (text.length > MAX_ASSET_BYTES) continue
      scripts.set(asset.name, text)
    } catch {
      // A source that can't be read is not a source the linter reads
    }
  }
  return scripts
}

function readProjectSource(resource: string): string | undefined {
  try {
    if (fs.statSync(resource).size > MAX_SOURCE_BYTES) return undefined
    return fs.readFileSync(resource, 'utf-8')
  } catch {
    return undefined
  }
}

// The files a module was emitted into, or undefined when the chunk graph
// can't say. Production concatenates modules, so the graph is asked about
// the outer module while the source comes from the inner ones.
function emittedFilesOf(
  compilation: ScannableCompilation,
  module: ScannableModule
): string[] | undefined {
  if (!compilation.chunkGraph) return undefined
  try {
    const files: string[] = []
    for (const chunk of compilation.chunkGraph.getModuleChunksIterable(
      module
    )) {
      for (const file of chunk.files || []) files.push(file)
    }
    return files
  } catch {
    return undefined
  }
}

/**
 * Finds project source that reads a Chromium-only API and still ships in the
 * built Gecko bundle. The source scan names the file, the emitted-asset check
 * clears a call the bundler compiled out behind a build-time browser branch,
 * and an emitted script nobody explains is reported under its own name so
 * nothing addons-linter would flag goes unmentioned.
 */
export function findGeckoUnsupportedApiUses(
  compilation: ScannableCompilation,
  manifestVersion: unknown
): GeckoUnsupportedApiUse[] {
  const apis = geckoUnsupportedApis(manifestVersion)
  const emitted = readEmittedScripts(compilation)
  const explained = new Set<string>()
  const uses = new Map<string, GeckoUnsupportedApiUse>()

  for (const outer of compilation.modules) {
    const inner = outer.modules ? [...outer.modules] : [outer]
    for (const module of inner) {
      const resource = scannableSourcePath(module.resource)
      if (!resource) continue
      const source = readProjectSource(resource)
      if (source === undefined) continue

      for (const api of apis) {
        const key = `${api}\0${resource}`
        if (uses.has(key) || !usesGeckoUnsupportedApi(source, api)) continue

        const files = emittedFilesOf(compilation, outer)
        if (files) {
          const carrying = files.filter((file) => {
            const text = emitted.get(file)
            return text !== undefined && usesGeckoUnsupportedApi(text, api)
          })
          // The bundler dropped the call, so the linter never sees it.
          if (!carrying.length) continue
          for (const file of carrying) explained.add(`${api}\0${file}`)
        }
        uses.set(key, {api, file: resource, emitted: false})
      }
    }
  }

  // Without a chunk graph nothing ties a script to its source, so the
  // source scan above is the whole report and this pass would repeat it.
  if (!compilation.chunkGraph) return [...uses.values()]

  for (const [name, text] of emitted) {
    for (const api of apis) {
      const key = `${api}\0${name}`
      if (explained.has(key) || !usesGeckoUnsupportedApi(text, api)) continue
      uses.set(key, {api, file: name, emitted: true})
    }
  }

  return [...uses.values()]
}

// The module graph names a file by its real path while the project path
// may go through a symlink, so a label is tried against both spellings.
function relativeToProject(projectPath: string, file: string): string {
  const candidates = [projectPath]
  try {
    candidates.push(fs.realpathSync(projectPath))
  } catch {
    // Ignore
  }
  for (const base of candidates) {
    const relative = path.relative(base, file)
    if (relative && !relative.startsWith('..')) return relative
  }
  return path.relative(projectPath, file) || file
}

// Warn-only, production Gecko builds only: development bundles keep every
// build-time branch, so the compiled-out check can't clear them there.
export function reportGeckoUnsupportedApis(
  compilation: Compilation,
  compiler: Compiler,
  browser: DevOptions['browser'],
  manifest: Manifest,
  projectPath: string
) {
  if (compiler.options.mode !== 'production') return
  if (!isGeckoBasedBrowser(String(browser))) return

  try {
    const uses = findGeckoUnsupportedApiUses(
      compilation as unknown as ScannableCompilation,
      manifest.manifest_version
    )
    for (const use of uses) {
      const label = use.emitted
        ? use.file
        : relativeToProject(projectPath, use.file)
      const text =
        use.api === 'sidePanel'
          ? messages.geckoSidePanelUnsupported(label)
          : messages.geckoActionUnsupportedOnMv2(label)
      const warn = new WebpackError(text) as Error & {
        file?: string
        name?: string
      }
      warn.name = 'GeckoUnsupportedApiWarning'
      warn.file = label
      compilation.warnings.push(warn)
    }
  } catch {
    // Diagnostics only, never fail the compile over the scan
  }
}
