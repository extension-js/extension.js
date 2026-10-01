// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {Compilation, type Compiler} from '@rspack/core'
import {isStaticThemeSource} from '../../../lib/manifest-utils'
import type {DevOptions, PluginInterface} from '../../../types'
import {getManifestContent} from '../manifest-lib/manifest'
import {
  findInjectedOnlyPermissionUses,
  type PermissionScanCompilation
} from './apply-dev-defaults'
import {
  devInjectedPermissions,
  partiallyGatedNote
} from './apply-dev-defaults-lib/dev-injected-permissions'

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
            if (isStaticThemeSource(this.manifestPath, this.browser)) return

            try {
              const manifest = getManifestContent(
                compilation,
                this.manifestPath
              )
              const declared = new Set<string>(
                (manifest.permissions as string[]) || []
              )
              const uses = findInjectedOnlyPermissionUses(
                compilation as unknown as PermissionScanCompilation,
                declared,
                devInjectedPermissions(manifest.manifest_version)
              )

              for (const [api, file] of uses) {
                const relative = path.relative(
                  path.dirname(this.manifestPath),
                  file
                )
                const gated = partiallyGatedNote(api)
                const outcome = gated
                  ? `in the packaged build${gated.replace(/^ Only part of the namespace is gated:/, ',')}`
                  : 'in the packaged build that call fails.'
                const text =
                  `manifest.json does not declare the "${api}" permission, but ` +
                  `${relative} uses chrome.${api}. Nothing grants it here, so ` +
                  `${outcome} Add "${api}" to permissions in manifest.json.`

                const WebpackErrorCtor = compiler.rspack?.WebpackError
                const warning = WebpackErrorCtor
                  ? new WebpackErrorCtor(text)
                  : (new Error(text) as Error)
                warning.name = 'UndeclaredPermissionWarning'
                if (!compilation.warnings) compilation.warnings = []

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
