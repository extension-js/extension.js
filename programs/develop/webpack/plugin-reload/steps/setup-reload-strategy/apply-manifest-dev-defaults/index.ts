import {Compilation, sources, Compiler} from '@rspack/core'
import {patchV2CSP, patchV3CSP} from './patch-csp'
import {patchWebResourcesV2, patchWebResourcesV3} from './patch-web-resources'
import patchBackground from './patch-background'
import patchExternallyConnectable from './patch-externally-connectable'
import * as utils from '../../../../lib/utils'
import {type PluginInterface} from '../../../reload-types'
import {DevOptions} from '../../../../../module'

export class ApplyManifestDevDefaults {
  private readonly manifestPath?: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private generateManifestPatches(compilation: Compilation) {
    const manifest = utils.getManifestContent(compilation, this.manifestPath!)

    const patchedManifest = {
      // Preserve all other user entries
      ...manifest,
      // Allow usig source map based on eval, using Manifest V2.
      // script-src 'self' 'unsafe-eval';
      // See https://github.com/awesome-webextension/webpack-target-webextension#source-map.
      // For V3, see https://developer.chrome.com/docs/extensions/migrating/improve-security/#update-csp
      content_security_policy:
        manifest.manifest_version === 3
          ? patchV3CSP(manifest)
          : patchV2CSP(manifest),

      // Set permission scripting as it's required for reload to work
      // with content scripts in v3. See:
      // https://github.com/awesome-webextension/webpack-target-webextension#content-script
      ...(manifest.manifest_version === 3
        ? manifest.permissions
          ? {
              permissions: [...new Set(['scripting', ...manifest.permissions])]
            }
          : {permissions: ['scripting']}
        : // : {permissions: []}
          {}),

      // Use the background script to inject the reload handler.
      ...patchBackground(manifest, this.browser),

      // A misuse of external_connectable can break communication
      // across extension reloads, so we ensure that the extension
      // is externally connectable to all other extensions.
      ...patchExternallyConnectable(manifest),

      // We need to allow /*.json', '/*.js', '/*.css to be able to load
      // the reload script and the reload handler assets.
      web_accessible_resources:
        manifest.manifest_version === 3
          ? patchWebResourcesV3(manifest)
          : patchWebResourcesV2(manifest)
    }

    const source = JSON.stringify(patchedManifest, null, 2)
    const rawSource = new sources.RawSource(source)

    if (compilation.getAsset('manifest.json')) {
      compilation.updateAsset('manifest.json', rawSource)
    }
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'run-chromium:apply-manifest-dev-defaults',
      (compilation) => {
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

              if (!!compilation && !!compiler.webpack.WebpackError) {
                compilation.errors.push(
                  new compiler.webpack.WebpackError(
                    `run-chromium: ${errorMessage}`
                  )
                )
              }
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
