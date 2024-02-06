import {type Compiler, Compilation, sources} from 'webpack'
import getManifestOverrides from '../manifest-overrides'
import getFilename from '../helpers/getFilename'

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

  private applyDevOverrides(overrides: Record<string, any>) {
    if (!overrides.content_scripts) return {}

    return overrides.content_scripts.map(
      (contentObj: {js: string[]; css: string[]}, index: number) => {
        if (contentObj.css.length && !contentObj.js.length) {
          contentObj.js = [
            getFilename(`content_scripts-${index}`, 'dev.js', [])
          ]
        }

        return contentObj
      }
    )
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'ManifestPlugin (UpdateManifestPlugin)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'ManifestPlugin (UpdateManifestPlugin)',
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
              ...JSON.parse(overrides)
            }

            // During development, if user has only CSS files in content_scripts,
            // we add a JS file to the content_scripts bundle so that
            // these files can be dynamically imported, thus allowing HMR.
            if (compiler.options.mode !== 'production') {
              if (patchedManifest.content_scripts) {
                patchedManifest.content_scripts =
                  this.applyDevOverrides(patchedManifest)
              }
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
