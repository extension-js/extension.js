import {type Compiler, Compilation, sources} from 'webpack'
import {getManifestContent} from '../lib/utils'
import {type PluginInterface, type Manifest} from '../types'

export class BrowserFieldsPlugin {
  private readonly browser: string
  private readonly manifestPath: string
  private readonly chromiumBasedBrowsers = ['chrome', 'edge', 'opera', 'brave']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  patchManifest(manifest: Manifest) {
    const chromiumBasedBrowsers = this.chromiumBasedBrowsers
    const browser = this.browser

    const patchedManifest = JSON.parse(
      JSON.stringify(manifest),
      function reviver(this: any, key: string, value: any) {
        const indexOfColon = key.indexOf(':')

        // Retain plain keys.
        if (indexOfColon === -1) {
          return value
        }

        // Replace browser:key keys.
        const prefix = key.substring(0, indexOfColon)

        if (
          prefix === browser ||
          (prefix === 'chromium' && chromiumBasedBrowsers.includes(browser))
        ) {
          this[key.substring(indexOfColon + 1)] = value
        }

        // Implicitly delete the key otherwise.
      }
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
