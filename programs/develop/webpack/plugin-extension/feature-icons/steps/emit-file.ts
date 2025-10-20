import * as fs from 'fs'
import * as path from 'path'
import {Compiler, sources, Compilation, WebpackError} from '@rspack/core'
import * as messages from '../../../webpack-lib/messages'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import * as utils from '../../../webpack-lib/utils'

export class EmitFile {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
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
                // Otherwise, treat leading "/" as extension root.
                let resolved = entry
                if (!fs.existsSync(resolved)) {
                  resolved = entry.startsWith('/')
                    ? path.join(manifestDir, entry.slice(1))
                    : path.isAbsolute(entry)
                      ? entry
                      : path.join(manifestDir, entry)
                }

                // Do not output if file doesn't exist.
                // If the user updates the path, this script runs again
                // and output the file accordingly.
                if (!fs.existsSync(resolved)) {
                  // Surface a non-fatal warning when an expected icon file is missing,
                  // unless it is explicitly excluded by user configuration.
                  if (!utils.shouldExclude(entry, this.excludeList)) {
                    const warn = new WebpackError(
                      messages.iconsMissingFile(entry)
                    )
                    warn.name = 'IconsPluginMissingFile'
                    // @ts-expect-error file is not typed
                    warn.file = entry
                    compilation.warnings.push(warn)
                  }
                  continue
                }

                if (!utils.shouldExclude(resolved, this.excludeList)) {
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
        }
      )
    })
  }
}
