// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {Compilation, type Compiler} from '@rspack/core'
import type {DevOptions, PluginInterface} from '../../../types'
import {declaredHostPatterns} from '../manifest-lib/dev-injected-hosts'
import {
  partiallyGatedNote,
  permissionsGrantedByHosts,
  scannedPermissions
} from '../manifest-lib/dev-injected-permissions'
import {
  getManifestContent,
  getOriginalManifest,
  isStaticThemeCompilation
} from '../manifest-lib/manifest'
import {
  findInjectedOnlyPermissionUses,
  type PermissionScanCompilation,
  useLocation
} from '../manifest-lib/permission-scan'
import {findShadowedPermission} from '../manifest-lib/shadowed-declaration'
import * as messages from '../messages'

// The dev session grants a few permissions for its own bridge and warns when
// the project leans on one it never declared. A shippable build grants
// nothing, so the same scan runs there and names the file before the
// store review or a user does.
export class WarnUndeclaredPermissions {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly devSession?: boolean

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.devSession = options.devSession
  }

  apply(compiler: Compiler) {
    if (!compiler?.hooks?.thisCompilation) return

    if (compiler.options.mode === 'development' && this.devSession !== false) {
      return
    }

    compiler.hooks.thisCompilation.tap(
      'manifest:warn-undeclared-permissions',
      (compilation) => {
        if (!compilation?.hooks?.processAssets) return

        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:warn-undeclared-permissions',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
          },
          () => {
            if (compilation.errors.length > 0) return
            if (!this.manifestPath) return

            if (
              isStaticThemeCompilation(
                compilation,
                this.manifestPath,
                this.browser
              )
            ) {
              return
            }

            try {
              const manifest = getManifestContent(
                compilation,
                this.manifestPath
              )
              const declared = new Set<string>([
                ...((manifest.permissions as string[]) || []),
                ...permissionsGrantedByHosts(declaredHostPatterns(manifest))
              ])
              const uses = findInjectedOnlyPermissionUses(
                compilation as unknown as PermissionScanCompilation,
                declared,
                scannedPermissions(manifest.manifest_version, this.browser)
              )

              for (const [api, use] of uses) {
                const relative = useLocation(this.manifestPath, use)
                const gated = partiallyGatedNote(api)
                const outcome = gated
                  ? `in the packaged build${gated.replace(/^ Only part of the namespace is gated:/, ',')}`
                  : 'in the packaged build that call fails.'
                const text = messages.undeclaredPermissionInBuild({
                  api,
                  location: relative,
                  tabField: use.field,
                  activeTabDeclared: declared.has('activeTab'),
                  outcome,
                  shadow: findShadowedPermission(
                    getOriginalManifest(compilation),
                    this.browser,
                    api
                  )
                })

                const WebpackErrorCtor = compiler.rspack?.WebpackError
                const warning = WebpackErrorCtor
                  ? new WebpackErrorCtor(text)
                  : (new Error(text) as Error)
                warning.name = 'UndeclaredPermissionWarning'
                compilation.warnings.push(
                  warning as (typeof compilation.warnings)[number]
                )
              }
            } catch {
              // Diagnostics only, never fail the compile over the scan
            }
          }
        )
      }
    )
  }
}
