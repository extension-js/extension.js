import path from 'path'
import {Compiler, Compilation, sources} from '@rspack/core'
import {getManifestOverrides} from '../manifest-overrides'
import {getFilename, getManifestContent} from '../../../lib/utils'
import {FilepathList, PluginInterface, Manifest} from '../../../webpack-types'

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
    compilation: Compilation,
    overrides: Record<string, any>
  ) {
    if (!overrides.content_scripts) return {}

    const outputPath = compilation.options.output?.path || ''

    // Collect all CSS assets in `content_scripts` for use in the manifest
    const contentScriptsCss = compilation
      .getAssets()
      .filter(
        (asset) =>
          asset.name.includes('content_scripts') && asset.name.endsWith('.css')
      )
      .map((asset) => path.join(outputPath, asset.name))

    // Assign the collected CSS files to each `content_scripts` entry
    for (const contentObj of overrides.content_scripts) {
      contentObj.css = contentScriptsCss.map((cssFilePath, index) =>
        getFilename(`content_scripts/content-${index}.css`, cssFilePath, {})
      )
    }

    return overrides.content_scripts
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
                this.excludeList || {}
              )

              const patchedManifest: Manifest = {
                // Preserve all uncatched user entries
                ...manifest,
                ...JSON.parse(overrides)
              }

              if (patchedManifest.content_scripts) {
                patchedManifest.content_scripts = this.applyProdOverrides(
                  compilation,
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
