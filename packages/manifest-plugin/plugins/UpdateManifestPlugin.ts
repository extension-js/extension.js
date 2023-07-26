import {type Compiler, Compilation, sources} from 'webpack'
import getManifestOverrides from '../manifest-overrides'

interface Options {
  manifestPath: string
  exclude?: string[]
}

export default class UpdateManifestPlugin {
  private readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: Options) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionManifestPlugin',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionManifestPlugin',
            // Summarize the list of existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () => {
            if (compilation.errors.length > 0) return

            const manifestSource = compilation
              .getAsset('manifest.json')
              ?.source.source()
            const manifest = JSON.parse((manifestSource || '').toString())
            const overrides = getManifestOverrides(
              this.manifestPath,
              manifest,
              this.exclude
            )

            const patchedManifest = {
              // Preserve all uncatched user entries
              ...manifest,
              ...(overrides && JSON.parse(overrides))
            }

            const source = JSON.stringify(patchedManifest, null, 2)
            const rawSource = new sources.RawSource(source)

            compilation.updateAsset('manifest.json', rawSource)
          }
        )
      }
    )
  }
}
