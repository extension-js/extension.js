// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {type Compiler, type EntryObject} from '@rspack/core'
import {getScriptEntries, getCssEntries} from '../scripts-lib/utils'
import {EXTENSIONJS_CONTENT_SCRIPT_LAYER} from '../contracts'
import {AddContentScriptWrapper} from './setup-reload-strategy/add-content-script-wrapper'
import {type FilepathList, type PluginInterface} from '../../../types'

const isRemoteUrl = (entry: string) => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(entry)
const isContentScriptFeature = (feature: string) =>
  feature.startsWith('content_scripts/')
const isScriptsFolderFeature = (feature: string) =>
  feature.startsWith('scripts/')

function createSequentialEntryModule(
  feature: string,
  entryImports: string[]
): string {
  const source = [
    `/* extension.js sequential entry: ${feature} */`,
    ...entryImports.map(
      (entryImport) => `import ${JSON.stringify(String(entryImport))};`
    )
  ].join('\n')

  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`
}

export class AddScripts {
  public readonly manifestPath: string
  public readonly includeList: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
  }

  public apply(compiler: Compiler): void {
    const bridgeScripts = AddContentScriptWrapper.getBridgeScripts(
      this.manifestPath
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
    let manifestJson: any = {}
    try {
      manifestJson = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'))
    } catch {
      manifestJson = {}
    }
    const resolveEntryPath = (entry: string) => {
      if (!entry || isRemoteUrl(entry)) return entry
      if (entry.startsWith('/') && !path.isAbsolute(entry)) {
        return path.join(projectPath, entry.slice(1))
      }
      if (path.isAbsolute(entry)) return entry
      return path.join(manifestDir, entry)
    }

    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      const rawEntries: string[] = Array.isArray(scriptPath)
        ? scriptPath || []
        : scriptPath
          ? [scriptPath]
          : []
      const resolvedEntries = rawEntries.map(resolveEntryPath)
      const scriptImports = getScriptEntries(resolvedEntries)
      const cssImports = getCssEntries(resolvedEntries)
      const entryImports = [...new Set([...scriptImports, ...cssImports])]
      const shouldUseSequentialEntryModule =
        isContentScriptFeature(feature) && scriptImports.length > 1
      const finalEntryImports = shouldUseSequentialEntryModule
        ? [createSequentialEntryModule(feature, entryImports)]
        : entryImports

      if (!finalEntryImports.length) continue

      newEntries[feature] =
        feature === 'background/service_worker'
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
