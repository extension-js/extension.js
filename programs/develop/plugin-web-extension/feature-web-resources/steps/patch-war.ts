// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler} from '@rspack/core'
import type {DevOptions, PluginInterface} from '../../../types'
import {
  getManifestContent,
  isStaticThemeCompilation
} from '../../feature-manifest/manifest-lib/manifest'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'
import {validateUserDeclaredWAR} from '../web-resources-lib/resolve-war'
import {getSharedFor} from '../web-resources-lib/shared'

// Placed by the manifest pipeline, between its update and its warnings, so
// every later manifest step reads the patched web_accessible_resources.
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
            if (
              isStaticThemeCompilation(
                compilation,
                this.manifestPath,
                this.browser
              )
            ) {
              return
            }

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
