// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {Compiler, Compilation, sources} from '@rspack/core'
import {getManifestOverrides} from '../manifest-overrides'
import {getFilename} from '../manifest-lib/paths'
import {
  getManifestContent,
  buildCanonicalManifest
} from '../manifest-lib/manifest'
import {PluginInterface, Manifest, DevOptions} from '../../../webpack-types'
import * as messages from '../messages'

export class UpdateManifest {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = (options as any).browser || 'chrome'
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
            // Run after env substitution but before REPORT-stage manifest
            // patchers. Later patchers read manifest.json from assets, so they
            // must see the canonical rewritten paths, and the write-to-disk
            // flow must persist those canonical paths before Chromium loads.
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE + 1
          },
          () => {
            if (compilation.errors.length > 0) return

            const manifest = getManifestContent(compilation, this.manifestPath)

            const patchedManifest = buildCanonicalManifest(
              this.manifestPath,
              manifest,
              this.browser
            ) as Manifest
            const overrides = getManifestOverrides(this.manifestPath, manifest)

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

            if (compilation.getAsset('manifest.json')) {
              compilation.updateAsset('manifest.json', rawSource)
            } else {
              compilation.emitAsset('manifest.json', rawSource)
            }
          }
        )
      }
    )
  }
}
