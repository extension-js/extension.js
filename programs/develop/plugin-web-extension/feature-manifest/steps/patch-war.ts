// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler} from '@rspack/core'
import {isStaticThemeSource} from '../../../lib/manifest-utils'
import type {DevOptions, PluginInterface} from '../../../types'
import {generateManifestPatches} from '../../feature-web-resources/web-resources-lib/generate-manifest'
import {validateUserDeclaredWAR} from '../../feature-web-resources/web-resources-lib/resolve-war'
import {getSharedFor} from '../../feature-web-resources/web-resources-lib/shared'
import {getManifestContent} from '../manifest-lib/manifest'

export class PatchWAR {
  public readonly manifestPath: string
  public readonly browser?: DevOptions['browser']

  constructor(options: PluginInterface & {browser?: DevOptions['browser']}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'manifest:patch-war',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:patch-war',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            // web_accessible_resources is one of the keys the theme schema
            // forbids, and a theme has no content script to serve anyway.
            if (isStaticThemeSource(this.manifestPath, this.browser)) return

            // A compile that already failed still names the author's own
            // mistakes in the key, so one run reports every fix needed.
            if (compilation.errors.length > 0) {
              if (!compilation.getAsset('manifest.json')) return

              validateUserDeclaredWAR(
                compilation,
                getManifestContent(compilation, this.manifestPath),
                this.browser as string
              )

              return
            }

            const shared = getSharedFor(compilation)
            generateManifestPatches(
              compilation,
              this.manifestPath,
              shared.entryImports || {},
              this.browser as string
            )
          }
        )
      }
    )
  }
}
