import {Compiler, Compilation, sources} from '@rspack/core'
import {getManifestOverrides} from '../manifest-overrides'
import {getFilename} from '../../../webpack-lib/paths'
import {getManifestContent} from '../../../webpack-lib/manifest'
import {FilepathList, PluginInterface, Manifest} from '../../../webpack-types'

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
          contentObj.js = [
            getFilename(`content_scripts-${index}`, 'dev.js', {})
          ]
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

            const overrides = getManifestOverrides(
              this.manifestPath,
              manifest,
              {}
            )

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

            const source = JSON.stringify(patchedManifest, null, 2)
            const rawSource = new sources.RawSource(source)

            compilation.updateAsset('manifest.json', rawSource)
          }
        )

        // During development, content_scripts are injected in the page
        // via <style> tag. In production, these styles are bundled
        // in a content_scripts CSS file, so we need to reference it
        // in the manifest.
        if (compiler.options.mode === 'production') {
          compilation.hooks.processAssets.tap(
            'manifest:update-manifest',
            () => {
              if (compilation.errors.length > 0) return

              const manifest = getManifestContent(
                compilation,
                this.manifestPath
              )

              const overrides = getManifestOverrides(
                this.manifestPath,
                manifest,
                {}
              )

              const patchedManifest: Manifest = {
                // Preserve all uncatched user entries
                ...manifest,
                ...JSON.parse(overrides)
              }

              const source = JSON.stringify(patchedManifest, null, 2)
              const rawSource = new sources.RawSource(source)

              compilation.updateAsset('manifest.json', rawSource)
            }
          )
        }
      }
    )
  }
}
