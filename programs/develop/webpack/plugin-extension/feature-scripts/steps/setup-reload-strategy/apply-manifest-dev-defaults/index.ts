import {Compilation, Compiler, sources} from '@rspack/core'
import {patchV2CSP, patchV3CSP} from './patch-csp'
import {patchWebResourcesV2, patchWebResourcesV3} from './patch-web-resources'
import patchBackground from './patch-background'
import patchExternallyConnectable from './patch-externally-connectable'
import * as utils from '../../../../../../develop-lib/utils'
import {type PluginInterface} from '../../../../../webpack-types'
import {DevOptions} from '../../../../../../module'

export class ApplyManifestDevDefaults {
  private readonly manifestPath?: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private generateManifestPatches(compilation: Compilation) {
    // Read original manifest then filter namespaced keys for the active browser
    const manifest = utils.getManifestContent(compilation, this.manifestPath!)
    const browser = this.browser as DevOptions['browser']
    const filtered = utils.filterKeysForThisBrowser(manifest, browser)

    const patchedManifest = {
      // Preserve all other user entries
      ...filtered,
      // Allow usig source map based on eval, using Manifest V2.
      // script-src 'self' 'unsafe-eval';
      // See https://github.com/awesome-webextension/webpack-target-webextension#source-map.
      // For V3, see https://developer.chrome.com/docs/extensions/migrating/improve-security/#update-csp
      content_security_policy:
        filtered.manifest_version === 3
          ? patchV3CSP(filtered)
          : patchV2CSP(filtered),

      // Set permission scripting as it's required for reload to work
      // with content scripts in v3. See:
      // https://github.com/awesome-webextension/webpack-target-webextension#content-script
      ...(filtered.manifest_version === 3
        ? filtered.permissions
          ? {
              permissions: [
                ...new Set(['scripting', 'management', ...filtered.permissions])
              ]
            }
          : {permissions: ['scripting', 'management']}
        : // : {permissions: []}
          {}),

      // Use the background script to inject the reload handler.
      ...patchBackground(filtered, this.browser),

      // A misuse of external_connectable can break communication
      // across extension reloads, so we ensure that the extension
      // is externally connectable to all other extensions.
      ...patchExternallyConnectable(manifest),

      // We need to allow /*.json', '/*.js', '/*.css to be able to load
      // the reload script and the reload handler assets.
      web_accessible_resources:
        filtered.manifest_version === 3
          ? patchWebResourcesV3(filtered)
          : patchWebResourcesV2(filtered)
    }

    const source = JSON.stringify(patchedManifest, null, 2)
    const rawSource = new sources.RawSource(source)

    if (compilation.getAsset('manifest.json')) {
      compilation.updateAsset('manifest.json', rawSource)
    }
  }

  apply(compiler: Compiler) {
    // Guard against missing hooks in mocked Compiler during tests
    if (!compiler?.hooks?.thisCompilation) return
    compiler.hooks.thisCompilation.tap(
      'run-chromium:apply-manifest-dev-defaults',
      (compilation) => {
        if (!compilation?.hooks?.processAssets) return
        compilation.hooks.processAssets.tap(
          {
            name: 'run-chromium:apply-manifest-dev-defaults',
            // Summarize the list of existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          (_assets) => {
            if (!this.manifestPath) {
              const errorMessage =
                'No manifest.json found in your extension bundle. Unable to patch manifest.json.'

              try {
                // Prefer WebpackError when available, otherwise push a generic Error in tests
                // @ts-ignore
                const WebpackErrorCtor = compiler?.rspack?.WebpackError
                compilation.errors.push(
                  WebpackErrorCtor
                    ? new WebpackErrorCtor(`run-chromium: ${errorMessage}`)
                    : new Error(`run-chromium: ${errorMessage}`)
                )
              } catch {}
              return
            }

            // Most of the patching happens in the manifest.json file.
            this.generateManifestPatches(compilation)
          }
        )
      }
    )
  }
}
