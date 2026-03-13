// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝╚═╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {Compilation, Compiler, sources} from '@rspack/core'
import {patchV2CSP, patchV3CSP} from './apply-dev-defaults-lib/patch-csp'
import {
  patchWebResourcesV2,
  patchWebResourcesV3
} from './apply-dev-defaults-lib/patch-web-resources'
import patchBackground from './apply-dev-defaults-lib/patch-background'
import patchExternallyConnectable from './apply-dev-defaults-lib/patch-externally-connectable'
import {
  getManifestContent,
  setCurrentManifestContent
} from '../manifest-lib/manifest'
import type {PluginInterface, DevOptions} from '../../../webpack-types'

/**
 * Applies dev-only manifest patches (CSP, permissions, background, WAR for reload).
 * Runs only in development mode, after WAR patching (REPORT+100).
 */
export class ApplyDevDefaults {
  private readonly manifestPath?: string
  private readonly browser: DevOptions['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.thisCompilation) return
    if (compiler.options.mode !== 'development') return

    compiler.hooks.thisCompilation.tap(
      'manifest:apply-dev-defaults',
      (compilation) => {
        if (!compilation?.hooks?.processAssets) return
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:apply-dev-defaults',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
          },
          () => {
            if (compilation.errors.length > 0) return
            if (!this.manifestPath) {
              try {
                const WebpackErrorCtor = (compiler as any).rspack?.WebpackError
                compilation.errors.push(
                  WebpackErrorCtor
                    ? new WebpackErrorCtor(
                        'manifest: No manifest.json path. Unable to apply dev defaults.'
                      )
                    : new Error(
                        'manifest: No manifest.json path. Unable to apply dev defaults.'
                      )
                )
              } catch {
                // ignore
              }
              return
            }

            const canonicalManifest = getManifestContent(
              compilation,
              this.manifestPath
            )

            const patchedManifest = {
              ...canonicalManifest,
              content_security_policy:
                canonicalManifest.manifest_version === 3
                  ? patchV3CSP(canonicalManifest)
                  : patchV2CSP(canonicalManifest),

              ...(canonicalManifest.manifest_version === 3
                ? canonicalManifest.permissions
                  ? {
                      permissions: [
                        ...new Set([
                          'scripting',
                          'management',
                          ...(canonicalManifest.permissions || [])
                        ])
                      ]
                    }
                  : {permissions: ['scripting', 'management']}
                : {}),

              ...patchBackground(canonicalManifest, this.browser),
              ...patchExternallyConnectable(canonicalManifest),
              web_accessible_resources:
                canonicalManifest.manifest_version === 3
                  ? patchWebResourcesV3(canonicalManifest)
                  : patchWebResourcesV2(canonicalManifest)
            }

            const source = JSON.stringify(patchedManifest, null, 2)
            const rawSource = new sources.RawSource(source)
            setCurrentManifestContent(compilation, source)

            if (compilation.getAsset('manifest.json')) {
              compilation.updateAsset('manifest.json', rawSource)
            }
          }
        )
      }
    )
  }
}
