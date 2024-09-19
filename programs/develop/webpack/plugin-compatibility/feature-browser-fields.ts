import {type Compiler, Compilation, sources} from 'webpack'
import {type PluginInterface, type Manifest} from '../webpack-types'
import {type DevOptions} from '../../commands/dev'
import {getManifestContent} from '../lib/utils'
import * as utils from '../lib/utils'

export class BrowserFieldsPlugin {
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
      'compatibility:browser-fields',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'compatibility:browser-fields',
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
