import {Compiler, Compilation, sources} from '@rspack/core'
import {getManifestOverrides} from '../manifest-overrides'
import {getFilename} from '../manifest-lib/paths'
import {getManifestContent} from '../manifest-lib/manifest'
import {PluginInterface, Manifest} from '../../../webpack-types'
import * as messages from '../messages'

export class UpdateManifest {
  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  private applyDevOverrides(overrides: Record<string, any>) {
    if (!overrides.content_scripts) return {}

    return overrides.content_scripts.map(
      (contentObj: {js: string[]; css: string[]}, index: number) => {
        if (contentObj.css.length && !contentObj.js.length) {
          contentObj.js = [getFilename(`content_scripts-${index}`, 'dev.js')]
        }

        return contentObj
      }
    )
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'manifest:update-manifest',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:update-manifest',
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () => {
            if (compilation.errors.length > 0) return

            const manifest = getManifestContent(compilation, this.manifestPath)

            const overrides = getManifestOverrides(this.manifestPath, manifest)

            const patchedManifest: Manifest = {
              // Preserve all uncatched user entries
              ...manifest,
              ...JSON.parse(overrides)
            }

            // During development, if user has only CSS files in content_scripts,
            // we add a JS file to the content_scripts bundle so that
            // these files can be dynamically imported, thus allowing HMR.
            if (compiler.options.mode === 'development') {
              if (patchedManifest.content_scripts) {
                patchedManifest.content_scripts =
                  this.applyDevOverrides(patchedManifest)
              }
            }

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              try {
                const overrideObj = JSON.parse(overrides || '{}')
                const overrideKeys = Object.keys(overrideObj || {}).length
                let devCssStubsAdded = 0

                if (
                  compiler.options.mode === 'development' &&
                  Array.isArray(patchedManifest.content_scripts)
                ) {
                  for (const cs of patchedManifest.content_scripts) {
                    try {
                      const hasCss =
                        Array.isArray((cs as any).css) &&
                        (cs as any).css.length > 0
                      const hasJs =
                        Array.isArray((cs as any).js) &&
                        (cs as any).js.length > 0
                      if (hasCss && hasJs && (cs as any).js.length === 1) {
                        devCssStubsAdded++
                      }
                    } catch {
                      // Ignore guard errors
                    }
                  }
                }
                console.log(
                  messages.manifestOverridesSummary(
                    overrideKeys,
                    devCssStubsAdded
                  )
                )
              } catch {
                // Ignore guard errors
              }
            }

            const source = JSON.stringify(patchedManifest, null, 2)
            const rawSource = new sources.RawSource(source)

            compilation.updateAsset('manifest.json', rawSource)
          }
        )

        // NOTE: Historically this plugin ran a second manifest override pass in production.
        // That caused overrides (including MAIN world bridge appends) to be applied twice,
        // producing manifest entries for bundles that do not exist (e.g. content-2.js).
        // The single PROCESS_ASSETS_STAGE_SUMMARIZE pass above is sufficient for both modes.
      }
    )
  }
}
