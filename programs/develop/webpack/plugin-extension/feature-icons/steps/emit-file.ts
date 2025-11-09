import * as fs from 'fs'
import * as path from 'path'
import {Compiler, sources, Compilation} from '@rspack/core'
import * as messages from '../messages'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'

// Shared utility for reporting errors or warnings to the compilation
function reportToCompilation(
  compilation: Compilation,
  message: string,
  compiler: Compiler,
  opts?: {type?: 'error' | 'warning'; file?: string}
) {
  const ErrorConstructor = compiler?.rspack?.WebpackError || Error
  const errObj = new ErrorConstructor(message) as Error & {file?: string}
  const arrKey = opts?.type === 'warning' ? 'warnings' : 'errors'

  if (opts?.file) errObj.file = opts.file

  if (!compilation[arrKey]) {
    compilation[arrKey] = []
  }

  compilation[arrKey].push(errObj)
}

export class EmitFile {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap('icons:emit-file', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'icons:emit-file',
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER
        },
        () => {
          if (compilation.errors.length > 0) return

          const iconFields = this.includeList || {}
          const manifestDir = path.dirname(this.manifestPath)
          const projectPath = compiler.options.context as string
          const publicDir = path.join(projectPath, 'public' + path.sep)

          for (const field of Object.entries(iconFields)) {
            const [feature, resource] = field

            if (resource === undefined) continue

            const normalizeToStrings = (response: unknown): string[] => {
              if (!response) return []

              if (typeof response === 'string') return [response]

              if (Array.isArray(response)) {
                const flat = response.flatMap((v) => {
                  if (typeof v === 'string') return [v]

                  if (v && typeof v === 'object') {
                    return Object.values(
                      v as Record<string, unknown>
                    ) as string[]
                  }

                  return []
                })

                return flat.filter((s): s is string => typeof s === 'string')
              }

              if (typeof response === 'object') {
                return Object.values(response).filter(
                  (value): value is string => typeof value === 'string'
                )
              }

              return []
            }

            const stringEntries = normalizeToStrings(resource)

            for (const entry of stringEntries) {
              // Resources from the manifest lib can come as undefined.
              if (entry) {
                // Normalize manifest paths:
                // - Leading "/" means extension root (public root), not OS root
                // - Relative paths are resolved from manifest directory
                // - Absolute OS paths are used as-is
                const manifestDir = path.dirname(this.manifestPath)

                // Prefer real absolute filesystem paths when they exist.
                // Otherwise, treat leading "/" as extension root (package root / public root).
                let resolved = entry

                if (!fs.existsSync(resolved)) {
                  resolved = entry.startsWith('/')
                    ? path.join(projectPath, entry.slice(1))
                    : path.isAbsolute(entry)
                      ? entry
                      : path.join(manifestDir, entry)
                }

                const isUnderPublic =
                  String(resolved).startsWith(publicDir) ||
                  (entry.startsWith('/') &&
                    fs.existsSync(
                      path.join(projectPath, 'public', entry.slice(1))
                    ))

                // Missing file: error and skip
                if (!fs.existsSync(resolved)) {
                  // Treat leading '/' as extension output-root (public root)
                  const isPublicRoot = entry.startsWith('/')
                  const outputRoot = compilation.options?.output?.path || ''
                  const parts = String(feature).split('/')
                  const group = parts[0]
                  const sub = parts[1] || ''

                  // Build a display path consistent with HTML feature:
                  // - For extension-root style (leading '/') NOT OS-absolute, show outputRoot + entry
                  // - For OS-absolute paths, show as-is
                  // - Otherwise, resolve relative to project root
                  const displayPath =
                    !path.isAbsolute(entry) && isPublicRoot
                      ? outputRoot
                        ? path.join(outputRoot, entry.slice(1))
                        : entry
                      : path.isAbsolute(entry)
                        ? entry
                        : path.join(projectPath, entry)
                  const isDefaultIconFamily =
                    (group === 'action' ||
                      group === 'browser_action' ||
                      group === 'page_action' ||
                      group === 'sidebar_action') &&
                    sub === 'default_icon'
                  const severity: 'error' | 'warning' =
                    group === 'icons' || isDefaultIconFamily
                      ? 'error'
                      : 'warning'

                  reportToCompilation(
                    compilation,
                    messages.iconsMissingFile(feature, displayPath, {
                      publicRootHint: isPublicRoot
                    }),
                    compiler,
                    {type: severity, file: 'manifest.json'}
                  )
                  continue
                }

                // Under public: do not emit; track for watch
                if (isUnderPublic) {
                  try {
                    compilation.fileDependencies.add(resolved)
                  } catch {
                    // ignore
                  }

                  continue
                }

                const source = fs.readFileSync(resolved)
                const rawSource = new sources.RawSource(source)

                const basename = path.basename(resolved)

                // Determine output directory from feature key. Supported keys:
                // - icons
                // - action/default_icon
                // - browser_action/default_icon
                // - browser_action/theme_icons
                // - page_action/default_icon
                // - sidebar_action/default_icon
                const parts = String(feature).split('/')
                const group = parts[0]
                const sub = parts[1] || ''

                let outputDir = group
                if (
                  (group === 'action' ||
                    group === 'browser_action' ||
                    group === 'page_action' ||
                    group === 'sidebar_action') &&
                  sub === 'default_icon'
                ) {
                  outputDir = 'icons'
                } else if (
                  group === 'browser_action' &&
                  sub === 'theme_icons'
                ) {
                  outputDir = 'browser_action'
                }

                const filename = `${outputDir}/${basename}`

                compilation.emitAsset(filename, rawSource)
              }
            }
          }
        }
      )
    })
  }
}
