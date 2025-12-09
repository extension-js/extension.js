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
          const publicDir = path.join(projectPath, 'public')

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
            let emittedCount = 0
            let underPublicCount = 0
            let missingCount = 0
            const entriesTotal = stringEntries.length

            for (const entry of stringEntries) {
              // Resources from the manifest lib can come as undefined.
              if (entry) {
                // Normalize manifest paths:
                // - Leading "/" means extension root (public root), backed by the project "public/" folder
                // - Relative paths are resolved from manifest directory
                // - Absolute OS paths are used as-is
                const manifestDir = path.dirname(this.manifestPath)

                let resolved = entry

                if (!fs.existsSync(resolved)) {
                  if (path.isAbsolute(entry) && entry.startsWith(projectPath)) {
                    // OS-absolute path under the project root. This can happen
                    // when upstream helpers resolve manifest fields into
                    // absolute filesystem paths. If the basename lives under
                    // project public/, prefer that location; otherwise, keep
                    // the absolute path.
                    const basename = path.basename(entry)
                    const publicCandidate = path.join(publicDir, basename)

                    if (process.env.EXTENSION_DEV_DEBUG_ICONS === '1') {
                      // eslint-disable-next-line no-console
                      console.log(
                        '[icons:emit-file] absolute entry',
                        JSON.stringify({
                          entry,
                          projectPath,
                          publicDir,
                          basename,
                          publicCandidate,
                          exists: fs.existsSync(publicCandidate)
                        })
                      )
                    }

                    resolved = fs.existsSync(publicCandidate)
                      ? publicCandidate
                      : entry
                  } else if (entry.startsWith('/')) {
                    // First, look under public/ because "/foo.png" is authored
                    // as an extension-root asset served from public/.
                    const publicCandidate = path.join(
                      projectPath,
                      'public',
                      entry.slice(1)
                    )

                    if (process.env.EXTENSION_DEV_DEBUG_ICONS === '1') {
                      // eslint-disable-next-line no-console
                      console.log(
                        '[icons:emit-file] leading-slash entry',
                        JSON.stringify({
                          entry,
                          projectPath,
                          publicCandidate,
                          exists: fs.existsSync(publicCandidate)
                        })
                      )
                    }

                    resolved = fs.existsSync(publicCandidate)
                      ? publicCandidate
                      : path.join(projectPath, entry.slice(1))
                  } else {
                    // For bare / relative icon paths coming from manifest fields, also
                    // respect the public/ convention before falling back to the
                    // manifest directory. This keeps behavior consistent with
                    // web_accessible_resources and allows icons declared as
                    // "icon.png" to live under public/icon.png.
                    const publicCandidate = path.join(publicDir, entry)

                    if (process.env.EXTENSION_DEV_DEBUG_ICONS === '1') {
                      // eslint-disable-next-line no-console
                      console.log(
                        '[icons:emit-file] relative entry',
                        JSON.stringify({
                          entry,
                          projectPath,
                          publicDir,
                          publicCandidate,
                          exists: fs.existsSync(publicCandidate),
                          manifestDir
                        })
                      )
                    }

                    if (fs.existsSync(publicCandidate)) {
                      resolved = publicCandidate
                    } else {
                      resolved = path.isAbsolute(entry)
                        ? entry
                        : path.join(manifestDir, entry)
                    }
                  }
                }

                // Robust containment check using path.relative to handle Windows cases
                const relToPublic = path.relative(publicDir, resolved)

                const isUnderPublic =
                  (relToPublic &&
                    !relToPublic.startsWith('..') &&
                    !path.isAbsolute(relToPublic)) ||
                  (entry.startsWith('/') &&
                    fs.existsSync(
                      path.join(projectPath, 'public', entry.slice(1))
                    ))

                // Missing file: error and skip
                if (!fs.existsSync(resolved)) {
                  // Treat leading '/' (extension-root style) as extension
                  // output-root (public root). OS-absolute filesystem paths
                  // under the project root are handled separately above and
                  // do not get the public-root hint.
                  const isPublicRoot =
                    entry.startsWith('/') && !entry.startsWith(projectPath)
                  const parts = String(feature).split('/')
                  const group = parts[0]
                  const sub = parts[1] || ''

                  // Build a display path consistent with HTML and web-resources features:
                  // - For extension-root style (leading '/') NOT OS-absolute, show <project>/public/<entry>
                  //   since those paths are served from the extension public root.
                  // - For OS-absolute paths, show as-is
                  // - Otherwise, resolve relative to project root
                  const displayPath =
                    !path.isAbsolute(entry) && isPublicRoot
                      ? path.join(projectPath, 'public', entry.slice(1))
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
                  missingCount++
                  continue
                }

                // Under public: do not emit; track for watch
                if (isUnderPublic) {
                  try {
                    compilation.fileDependencies.add(resolved)
                  } catch {
                    // ignore
                  }

                  underPublicCount++
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
                emittedCount++
              }
            }

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                messages.iconsEmitSummary(feature, {
                  entries: entriesTotal,
                  underPublic: underPublicCount,
                  emitted: emittedCount,
                  missing: missingCount
                })
              )
            }
          }
        }
      )
    })
  }
}
