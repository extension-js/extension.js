import {type Compiler, Compilation, sources} from '@rspack/core'
import {type PluginInterface, type Manifest} from '../webpack-types'
import {type DevOptions} from '../../develop-lib/config-types'
import {getManifestContent} from '../webpack-lib/utils'
import * as utils from '../webpack-lib/utils'

export class BrowserSpecificFieldsPlugin {
  private readonly browser: DevOptions['browser']
  private readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  patchManifest(manifest: Manifest) {
    const patchedManifest = utils.filterKeysForThisBrowser(
      manifest,
      this.browser
    )

    return JSON.stringify(patchedManifest, null, 2)
  }

  apply(compiler: Compiler): void {
    compiler.hooks.compilation.tap(
      'compatibility:browser-specific-fields',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'compatibility:browser-specific-fields',
            // One after PROCESS_ASSETS_STAGE_ADDITIONS, where
            // we first emit the manifest.json asset.
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE
          },
          () => {
            const manifest = getManifestContent(compilation, this.manifestPath)
            const patchedSource = this.patchManifest(manifest)
            const rawSource = new sources.RawSource(patchedSource)

            compilation.updateAsset('manifest.json', rawSource)
          }
        )
      }
    )
  }
}
