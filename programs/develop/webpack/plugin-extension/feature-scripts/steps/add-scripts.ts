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
import {AddContentScriptWrapper} from './setup-reload-strategy/add-content-script-wrapper'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import * as messages from '../messages'

const isRemoteUrl = (entry: string) => /^([a-z][a-z0-9+.-]*:)?\/\//i.test(entry)

export class AddScripts {
  public readonly manifestPath: string
  public readonly includeList: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
  }

  public apply(compiler: Compiler): void {
    // Merge bridge scripts into includeList internally
    const bridgeScripts = AddContentScriptWrapper.getBridgeScripts(
      this.manifestPath
    )
    const mergedIncludeList: FilepathList = {
      ...this.includeList,
      ...bridgeScripts
    }
    const scriptFields = mergedIncludeList

    // Validate includeList (manifest-derived and extras)
    // early and fail before browser launch
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
                if (!entry || typeof entry !== 'string') continue
                if (isRemoteUrl(entry)) continue

                // Resolve authoring convention:
                // - Leading '/' = extension root (public root), not OS root
                // - Relative = from manifest dir
                // - Absolute OS = as-is
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

                const lines: string[] = []
                lines.push(
                  `Check the ${feature.replace('/', '.')} field in your manifest.json file.`
                )
                lines.push(
                  `The script path must point to an existing file that will be bundled.`
                )
                if (isPublicRoot) {
                  lines.push(
                    `Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.`
                  )
                }
                lines.push('')
                lines.push(`NOT FOUND ${displayPath}`)

                const err = new ErrorCtor(lines.join('\n')) as Error & {
                  file?: string
                  name?: string
                }
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
    const resolveEntryPath = (entry: string) => {
      if (!entry) return entry
      if (isRemoteUrl(entry)) return entry

      if (entry.startsWith('/') && !path.isAbsolute(entry)) {
        // Leading "/" is the extension output root (public/)
        return path.join(projectPath, entry.slice(1))
      }

      if (path.isAbsolute(entry)) return entry
      return path.join(manifestDir, entry)
    }

    let entriesAdded = 0
    let publicTracked = 0

    for (const [feature, scriptPath] of Object.entries(scriptFields)) {
      const rawEntries: string[] = Array.isArray(scriptPath)
        ? scriptPath || []
        : scriptPath
          ? [scriptPath]
          : []
      const resolvedEntries = rawEntries.map(resolveEntryPath)
      const scriptImports = getScriptEntries(resolvedEntries)
      const cssImports = getCssEntries(resolvedEntries)
      const allImports = [...scriptImports, ...cssImports]
      const entryImports = allImports

      if (cssImports.length || scriptImports.length) {
        // Apply entry-specific configuration for service workers
        if (feature === 'background/service_worker') {
          // Check if this is a module service worker
          const manifest = JSON.parse(
            fs.readFileSync(this.manifestPath, 'utf8')
          )
          const isModuleServiceWorker = manifest.background?.type === 'module'

          newEntries[feature] = {
            import: entryImports,
            // Only apply import-scripts for non-module service workers
            // This ensures non-module service workers work correctly without affecting module ones
            ...(isModuleServiceWorker ? {} : {chunkLoading: 'import-scripts'})
          }
        } else {
          newEntries[feature] = {import: entryImports}
        }
        entriesAdded++
      }
    }

    // Add all the new entries to the compilation at once
    compiler.options.entry = {
      ...compiler.options.entry,
      ...newEntries
    }
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      console.log(messages.scriptsEntriesSummary(entriesAdded, publicTracked))
    }
  }
}
