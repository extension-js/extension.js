import path from 'path'
import {type Compiler, Compilation, sources} from 'webpack'
import {getManifestOverrides} from '../manifest-overrides'
import {getFilename, getManifestContent} from '../../../lib/utils'
import {
  type FilepathList,
  type PluginInterface,
  type Manifest
} from '../../../webpack-types'

export class UpdateManifest {
  public readonly manifestPath: string
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.excludeList = options.excludeList
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

  private applyProdOverrides(
    compiler: Compiler,
    overrides: Record<string, any>
  ) {
    if (!overrides.content_scripts) return {}

    return overrides.content_scripts.map(
      (contentObj: {js: string[]; css: string[]}, index: number) => {
        if (contentObj.js.length && !contentObj.css.length) {
          const outputPath = compiler.options.output?.path || ''

          // Make a .css file for every .js file in content_scripts
          // so we can later reference it in the manifest.
          contentObj.css = contentObj.js.map((js: string) => {
            const contentCss = path.join(outputPath, js.replace('.js', '.css'))
            return getFilename(
              `content_scripts/content-${index}.css`,
              contentCss,
              {}
            )
          })
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
              this.excludeList || {}
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

            // During production, webpack styles are bundled in a CSS file,
            // and not injected in the page via <style> tag. We need to
            // reference these files in the manifest.
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
          compilation.hooks.afterProcessAssets.tap(
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
                this.excludeList || {}
              )

              const patchedManifest: Manifest = {
                // Preserve all uncatched user entries
                ...manifest,
                ...JSON.parse(overrides)
              }

              if (patchedManifest.content_scripts) {
                patchedManifest.content_scripts = this.applyProdOverrides(
                  compiler,
                  patchedManifest
                )
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
