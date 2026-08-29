// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler, EntryObject} from '@rspack/core'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {stripBom} from '../../../lib/parse-json-safe'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import {classicConcatEntry, isClassicScript} from '../../shared/classic-concat'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../contracts'
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

function createSequentialEntryModule(
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
    `/* extension.js sequential entry: ${feature} */`,
    ...jsFiles.map(
      (entryImport) => `import ${JSON.stringify(String(entryImport))};`
    )
  ].join('\n')

  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
}

export class AddScripts {
  public readonly manifestPath: string
  public readonly includeList: FilepathList
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
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

    if (compiler?.hooks?.thisCompilation?.tap) {
      compiler.hooks.thisCompilation.tap(
        'scripts:validate-include-list',
        (compilation) => {
          try {
            const manifestDir = path.dirname(this.manifestPath)
            const outputRoot = compilation.options?.output?.path || ''
            const ErrorCtor = compiler.rspack?.WebpackError || Error

            for (const [feature, raw] of Object.entries(scriptFields)) {
              const rawEntries: string[] = Array.isArray(raw)
                ? (raw as string[]).filter(Boolean)
                : raw
                  ? [raw as string]
                  : []

              for (const entry of rawEntries) {
                if (!entry || typeof entry !== 'string' || isRemoteUrl(entry)) {
                  continue
                }

                let resolved = entry
                if (!fs.existsSync(resolved)) {
                  resolved = path.isAbsolute(entry)
                    ? entry
                    : entry.startsWith('/')
                      ? path.join(manifestDir, entry.slice(1))
                      : path.join(manifestDir, entry)
                }

                if (fs.existsSync(resolved)) continue

                const isPublicRoot =
                  entry.startsWith('/') && !path.isAbsolute(entry)
                const displayPath = isPublicRoot
                  ? outputRoot
                    ? path.join(outputRoot, entry.slice(1))
                    : entry
                  : resolved

                const err = new ErrorCtor(
                  [
                    `Check the ${feature.replace('/', '.')} field in your manifest.json file.`,
                    `The script path must point to an existing file that will be bundled.`,
                    isPublicRoot
                      ? `Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.`
                      : '',
                    '',
                    `NOT FOUND ${displayPath}`
                  ]
                    .filter(Boolean)
                    .join('\n')
                ) as Error & {file?: string; name?: string}
                err.file = 'manifest.json'
                err.name = 'ScriptsMissingFile'
                ;(compilation.errors ||= []).push(err)
              }
            }
          } catch {
            // ignore guard errors
          }
        }
      )
    }

    const newEntries: Record<string, EntryObject> = {}
    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir
    let manifestJson: {
      manifest_version?: unknown
      background?: {type?: unknown}
    } = {}
    try {
      manifestJson = JSON.parse(
        stripBom(fs.readFileSync(this.manifestPath, 'utf8'))
      )
    } catch {
      manifestJson = {}
    }
    const resolveEntryPath = (entry: string) =>
      resolveScriptEntryPath(entry, manifestDir, projectPath)

    // A scripts/ file also claimed by a content_scripts group is already built
    // by that entry; a standalone duplicate trips rspack on vendored UMD libs.
    const claimedByContentScript = new Set<string>()
    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      if (!isContentScriptFeature(feature)) continue
      const rawEntries: string[] = Array.isArray(scriptPath)
        ? scriptPath || []
        : scriptPath
          ? [scriptPath]
          : []
      for (const resolved of getScriptEntries(
        rawEntries.map(resolveEntryPath)
      )) {
        claimedByContentScript.add(path.resolve(resolved))
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
            (p) => !claimedByContentScript.has(path.resolve(p))
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

      newEntries[feature] = runsAsWorker
        ? {
            import: finalEntryImports,
            ...(manifestJson.background?.type === 'module'
              ? {}
              : {chunkLoading: 'import-scripts'})
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
