// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler} from '@rspack/core'
import type {DevOptions, PluginInterface} from '../../../types'
import {generateManifestPatches} from '../../feature-web-resources/web-resources-lib/generate-manifest'
import {getSharedFor} from '../../feature-web-resources/web-resources-lib/shared'

/**
 * Patches manifest.json with web_accessible_resources from content script
 * imports. Depends on CollectContentEntryImports (feature-web-resources)
 * populating getSharedFor(compilation).entryImports before this runs.
 */
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
            if (compilation.errors.length > 0) return

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
