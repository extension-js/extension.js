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
import type {PluginInterface, DevOptions} from '../../../types'

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

            // Match patterns of every declared content script. Used below to
            // grant host access for the dev open-tab re-injection.
            const contentScriptMatches: string[] = Array.isArray(
              canonicalManifest.content_scripts
            )
              ? (canonicalManifest.content_scripts as any[]).flatMap(
                  (cs: any) => (Array.isArray(cs?.matches) ? cs.matches : [])
                )
              : []

            // MV3 only, and only when there are content scripts: ensure the
            // extension has host access to the pages its content scripts run on,
            // so the SW can chrome.scripting.executeScript the fresh script into
            // already-open tabs on save (the controller-less content-script
            // reload under --no-browser). Union with any declared host
            // permissions; never written to the production manifest.
            const hostPermissionsPatch =
              canonicalManifest.manifest_version === 3 &&
              contentScriptMatches.length > 0
                ? {
                    host_permissions: [
                      ...new Set([
                        ...((canonicalManifest.host_permissions as string[]) ||
                          []),
                        ...contentScriptMatches
                      ])
                    ]
                  }
                : {}

            const patchedManifest = {
              ...canonicalManifest,
              content_security_policy:
                canonicalManifest.manifest_version === 3
                  ? patchV3CSP(canonicalManifest)
                  : patchV2CSP(canonicalManifest),

              // Dev-only permissions for the control bridge + reload loop:
              //   - scripting: re-inject the fresh content script into open tabs
              //     on save (chrome.scripting.executeScript).
              //   - tabs: chrome.tabs.query({url}) to find those tabs.
              //   - management: used by the bridge act verbs.
              // MV2 (Firefox) gets only `tabs` (scripting/management are MV3).
              ...(canonicalManifest.manifest_version === 3
                ? {
                    permissions: [
                      ...new Set([
                        'scripting',
                        'tabs',
                        'management',
                        ...(canonicalManifest.permissions || [])
                      ])
                    ]
                  }
                : {
                    permissions: [
                      ...new Set([
                        'tabs',
                        ...(canonicalManifest.permissions || [])
                      ])
                    ]
                  }),
              ...hostPermissionsPatch,

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
