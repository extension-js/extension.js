// ██╗    ██╗███████╗██████╗       ██████╗ ███████╗███████╗ ██████╗ ██╗   ██╗██████╗  ██████╗███████╗███████╗
// ██║    ██║██╔════╝██╔══██╗      ██╔══██╗██╔════╝██╔════╝██╔═══██╗██║   ██║██╔══██╗██╔════╝██╔════╝██╔════╝
// ██║ █╗ ██║█████╗  ██████╔╝█████╗██████╔╝█████╗  ███████╗██║   ██║██║   ██║██████╔╝██║     █████╗  ███████╗
// ██║███╗██║██╔══╝  ██╔══██╗╚════╝██╔══██╗██╔══╝  ╚════██║██║   ██║██║   ██║██╔══██╗██║     ██╔══╝  ╚════██║
// ╚███╔███╔╝███████╗██████╔╝      ██║  ██║███████╗███████║╚██████╔╝╚██████╔╝██║  ██║╚██████╗███████╗███████║
//  ╚══╝╚══╝ ╚══════╝╚═════╝       ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {Compilation, Compiler} from '@rspack/core'
import type {FilepathList} from '../../../webpack-types'
import {getSharedFor} from '../web-resources-lib/shared'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'

export class PatchManifestWebResources {
  public readonly manifestPath: string
  public readonly browser?: string

  constructor(options: {manifestPath: string; browser?: string}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'plugin-extension:feature-web-resources:patch-manifest',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'plugin-extension:feature-web-resources:patch-manifest',
            // Use a late stage to ensure chunk files (from dynamic imports) are finalized
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const shared = getSharedFor(compilation)
            generateManifestPatches(
              compilation,
              this.manifestPath,
              shared.entryImports || {},
              this.browser
            )
          }
        )
      }
    )
  }
}
