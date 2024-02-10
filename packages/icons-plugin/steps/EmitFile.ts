import fs from 'fs'
import path from 'path'
import webpack, {sources, Compilation} from 'webpack'
import {type IconsPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'
import {shouldExclude} from '../helpers/utils'
import messages from '../helpers/messages'

export default class EmitFile {
  private readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: IconsPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'Iconslugin (EmitFile)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'Iconslugin (EmitFile)',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_TRANSFER
          },
          () => {
            if (compilation.errors.length > 0) return

            const iconFields = manifestFields(this.manifestPath).icons

            for (const field of Object.entries(iconFields)) {
              const [feature, resource] = field

              if (resource === undefined) continue

              const iconEntries = Array.isArray(resource)
                ? typeof resource[0] === 'string'
                  ? resource
                  : resource.map(Object.values).flat()
                : [resource]

              for (const entry of iconEntries) {
                // Resources from the manifest lib can come as undefined.
                if (entry) {
                  // Do not output if file doesn't exist.
                  // If the user updates the path, this script runs again
                  // and output the file accordingly.
                  if (!fs.existsSync(entry)) {
                    messages.entryNotFoundWarn(compilation, feature, entry)
                    continue
                  }

                  if (!shouldExclude(entry, this.exclude || [])) {
                    const source = fs.readFileSync(entry)
                    const rawSource = new sources.RawSource(source)

                    const basename = path.basename(entry)
                    // Output theme_icons to the same folder as browser_action
                    // TODO: cezaraugusto at some point figure out a standard
                    // way to output paths from the manifest fields.
                    const featureName = feature.endsWith('theme_icons')
                      ? feature.replace('theme_icons', '')
                      : feature
                    const filename = `${featureName}/${basename}`

                    compilation.emitAsset(filename, rawSource)
                  }
                }
              }
            }
          }
        )
      }
    )
  }
}
