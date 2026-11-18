// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {parseAuthoredJson} from '../../../lib/parse-json-safe'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import {classicConcatEntry, isClassicScript} from '../../shared/classic-concat'
import {
  EXTENSIONJS_CONTENT_SCRIPT_LAYER,
  parseCanonicalContentScriptEntryIndex
} from '../contracts'
import * as messages from '../messages'
import {
  getCssEntries,
  getScriptEntries,
  isRemoteUrl,
  resolveScriptEntryPath
} from '../scripts-lib/utils'
import {AddContentScriptWrapper} from './add-content-script-wrapper'

const isContentScriptFeature = (feature: string) =>
  feature.startsWith('content_scripts/')
const isScriptsFolderFeature = (feature: string) =>
  feature.startsWith('scripts/')
const isBackgroundScriptsFeature = (feature: string) =>
  feature === 'background/scripts'

// The field as the manifest writes it: a content script group lists its
// scripts and its stylesheets apart, under the index of the group.
function manifestFieldOf(feature: string, entry: string): string {
  const group = parseCanonicalContentScriptEntryIndex(feature)

  if (group === undefined) return feature.replace('/', '.')

  const list = /\.(?:css|scss|sass|less)$/i.test(entry) ? 'css' : 'js'

  return `content_scripts[${group}].${list}`
}

export function createSequentialEntryModule(
  feature: string,
  scriptImports: string[]
): string {
  // Only JS is sequenced/concatenated here. CSS stays a bare entry import;
  // routed through this module it flips to asset/inline and never emits.
  const jsFiles = scriptImports

  // Classic content scripts share one global scope in the browser; ES-module
  // sequencing breaks that, so all-classic groups concatenate into one module.
  const concatEligible = (f: string) => /\.(js|cjs|ts)$/i.test(f)
  const concatenateClassic =
    jsFiles.length > 1 &&
    jsFiles.every((f) => concatEligible(f) && isClassicScript(f))

  if (concatenateClassic) {
    return classicConcatEntry(feature, jsFiles)
  }

  const source = [
    `/* Extension.js sequential entry: ${feature} */`,
    ...jsFiles.map(
      (entryImport) => `import ${JSON.stringify(String(entryImport))};`
    )
  ].join('\n')

  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
}

export class AddScripts {
  public readonly manifestPath: string
  public readonly includeList: FilepathList
  // The files a field names and the build withholds, which are no entry.
  public readonly withheldList: FilepathList
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface & {withheldList?: FilepathList}) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
    this.withheldList = options.withheldList || {}
    this.browser = options.browser || 'chrome'
  }

  public apply(compiler: Compiler): void {
    const bridgeScripts = AddContentScriptWrapper.getBridgeScripts(
      this.manifestPath,
      this.browser
    )
    const scriptFields: FilepathList = {
      ...this.includeList,
      ...bridgeScripts
    }

    compiler.hooks.thisCompilation.tap(
      'scripts:validate-include-list',
      (compilation) => {
        const ErrorCtor = compiler.rspack?.WebpackError || Error

        try {
          const manifestDir = path.dirname(this.manifestPath)
          const outputRoot = compilation.options?.output?.path || ''

          const projectPath =
            (compiler.options.context as string) || manifestDir
          const listOf = (raw: FilepathList[string]): string[] =>
            Array.isArray(raw)
              ? (raw as string[]).filter(Boolean)
              : raw
                ? [raw as string]
                : []
          // A withheld file is reported in the words a missing one gets.
          const named = [
            ...Object.entries(scriptFields).map(
              ([feature, raw]) => [feature, listOf(raw), false] as const
            ),
            ...Object.entries(this.withheldList).map(
              ([feature, raw]) => [feature, listOf(raw), true] as const
            )
          ]

          for (const [feature, rawEntries, isWithheld] of named) {
            for (const entry of rawEntries) {
              if (!entry || typeof entry !== 'string' || isRemoteUrl(entry)) {
                continue
              }

              let resolved = entry

              if (isWithheld) {
                resolved = resolveScriptEntryPath(
                  entry,
                  manifestDir,
                  projectPath
                )
              } else if (!fs.existsSync(resolved)) {
                resolved = path.isAbsolute(entry)
                  ? entry
                  : entry.startsWith('/')
                    ? path.join(manifestDir, entry.slice(1))
                    : path.join(manifestDir, entry)
              }

              if (!isWithheld && fs.existsSync(resolved)) continue

              // A withheld file is on disk, so its own path is the one named.
              const isPublicRoot =
                !isWithheld && entry.startsWith('/') && !path.isAbsolute(entry)
              const displayPath = isPublicRoot
                ? outputRoot
                  ? path.join(outputRoot, entry.slice(1))
                  : entry
                : resolved

              const err = new ErrorCtor(
                messages.scriptsMissingFile(
                  isPublicRoot
                    ? entry
                    : path
                        .relative(manifestDir, resolved)
                        .split(path.sep)
                        .join('/'),
                  manifestFieldOf(feature, entry),
                  displayPath,
                  isPublicRoot
                )
              ) as Error & {file?: string; name?: string}
              err.file = 'manifest.json'
              err.name = 'ScriptsMissingFile'
              ;(compilation.errors ||= []).push(err)
            }
          }
        } catch (error) {
          // A check that stops half way reports nothing for the files it
          // never reached, so the build says so instead of passing quietly.
          const failure = new ErrorCtor(
            messages.scriptPathsCheckFailed(
              String((error as Error)?.message || error)
            )
          ) as Error & {file?: string; cause?: unknown}
          failure.file = 'manifest.json'
          failure.name = 'ScriptsPathCheckFailed'
          failure.cause = error
          ;(compilation.errors ||= []).push(failure)
        }
      }
    )

    const newEntries: Record<
      string,
      Exclude<
        Compiler['options']['entry'],
        (...args: never[]) => unknown
      >[string]
    > = {}
    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir
    let manifestJson: {
      manifest_version?: unknown
      background?: {type?: unknown}
    } = {}

    try {
      // A chromium:background module worker is invisible to a raw read, so the
      // entry got importScripts chunk loading while the worker itself is ESM.
      manifestJson = filterKeysForThisBrowser(
        parseAuthoredJson(fs.readFileSync(this.manifestPath, 'utf8')),
        this.browser
      ) as typeof manifestJson
    } catch {
      manifestJson = {}
    }

    const resolveEntryPath = (entry: string) =>
      resolveScriptEntryPath(entry, manifestDir, projectPath)

    // A scripts/ file the manifest also names under a field of its own is
    // already built by that field's entry, at the path the emitted manifest
    // points at. Entering it again under scripts/ ships the same bundle twice
    // and, on vendored UMD libs, trips rspack. Every declared field claims the
    // same way: a service worker is no different from a content script group.
    const claimedByManifestField = new Set<string>()

    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      if (isScriptsFolderFeature(feature)) continue

      const rawEntries: string[] = Array.isArray(scriptPath)
        ? scriptPath || []
        : scriptPath
          ? [scriptPath]
          : []

      for (const resolved of getScriptEntries(
        rawEntries.map(resolveEntryPath)
      )) {
        claimedByManifestField.add(path.resolve(resolved))
      }
    }

    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      const rawEntries: string[] = Array.isArray(scriptPath)
        ? scriptPath || []
        : scriptPath
          ? [scriptPath]
          : []
      const resolvedEntries = rawEntries.map(resolveEntryPath)
      const scriptImports = isScriptsFolderFeature(feature)
        ? getScriptEntries(resolvedEntries).filter(
            (p) => !claimedByManifestField.has(path.resolve(p))
          )
        : getScriptEntries(resolvedEntries)
      const cssImports = getCssEntries(resolvedEntries)
      const entryImports = [...new Set([...scriptImports, ...cssImports])]
      const shouldUseSequentialEntryModule =
        (isContentScriptFeature(feature) ||
          isBackgroundScriptsFeature(feature)) &&
        scriptImports.length > 1
      const finalEntryImports = shouldUseSequentialEntryModule
        ? [createSequentialEntryModule(feature, scriptImports), ...cssImports]
        : entryImports

      if (!finalEntryImports.length) continue

      // On Chromium an MV3 background.scripts bundle is repointed to
      // service_worker (patch-chromium-background), so it boots as a worker
      // with no `document`: it needs the same worker chunk loader as a
      // declared service_worker or a split chunk kills the background.
      const runsAsWorker =
        feature === 'background/service_worker' ||
        (isBackgroundScriptsFeature(feature) &&
          Number(manifestJson.manifest_version) === 3 &&
          !isGeckoBasedBrowser(String(this.browser)))

      // A module worker cannot importScripts, and a service worker cannot
      // import() either, so it gets no chunk loader at all: the default
      // jsonp loader would read document.baseURI and kill it on start.
      const workerChunkLoading: false | 'import-scripts' =
        manifestJson.background?.type === 'module' ? false : 'import-scripts'

      newEntries[feature] = runsAsWorker
        ? {
            import: finalEntryImports,
            chunkLoading: workerChunkLoading,
            // A Chromium service worker can fetch a script only while it
            // installs, so what import() names ships inside the worker file.
            asyncChunks: false
          }
        : {
            import: finalEntryImports,
            ...(isContentScriptFeature(feature) ||
            isScriptsFolderFeature(feature)
              ? {layer: EXTENSIONJS_CONTENT_SCRIPT_LAYER}
              : {})
          }
    }

    compiler.options.entry = {
      ...compiler.options.entry,
      ...newEntries
    }
  }
}
