import * as fs from 'fs'
import * as path from 'path'
import {Compiler, sources, Compilation} from '@rspack/core'
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
                  // WARN: This is handled by the manifest plugin.
                  // Do not add an error handler here.
                  continue
                }

                if (!utils.shouldExclude(resolved, this.excludeList)) {
                  const source = fs.readFileSync(resolved)
                  const rawSource = new sources.RawSource(source)

                  const basename = path.basename(resolved)
                  // Output theme_icons to the same folder as browser_action
                  // TODO: cezaraugusto at some point figure out a standard
                  // way to output paths from the manifest fields.
                  const featureName = feature.endsWith('theme_icons')
                    ? feature.replace('theme_icons', '')
                    : feature
                  // Align emitted asset folders with manifest overrides:
                  // - action.default_icon → icons/
                  // - browser_action.default_icon → icons/
                  // - page_action.default_icon → icons/
                  // - sidebar_action.default_icon → icons/
                  const outputDir =
                    featureName === 'action' ||
                    featureName === 'browser_action' ||
                    featureName === 'page_action' ||
                    featureName === 'sidebar_action'
                      ? 'icons'
                      : featureName
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
