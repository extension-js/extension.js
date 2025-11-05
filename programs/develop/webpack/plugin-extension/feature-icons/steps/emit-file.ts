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

            const iconEntries: unknown[] = Array.isArray(resource)
              ? typeof resource[0] === 'string'
                ? resource
                : resource.map(Object.values).flat()
              : [resource]

            const stringEntries = iconEntries.filter(
              (entry): entry is string => typeof entry === 'string'
            )

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

                // Missing file: warn and skip
                if (!fs.existsSync(resolved)) {
                  const isPublicRoot = entry.startsWith('/')
                  const outputRoot = compilation.options?.output?.path || ''
                  const displayPath = isPublicRoot
                    ? outputRoot
                      ? path.join(outputRoot, entry.slice(1))
                      : entry
                    : resolved
                  reportToCompilation(
                    compilation,
                    messages.iconsMissingFile(feature, displayPath, {
                      publicRootHint: isPublicRoot
                    }),
                    compiler,
                    {type: 'warning', file: 'manifest.json'}
                  )
                  continue
                }

                // Under public: do not emit; track for watch
                if (isUnderPublic) {
                  try {
                    compilation.fileDependencies.add(resolved)
                  } catch {}
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
