import {Compilation, Compiler} from '@rspack/core'
import type {FilepathList} from '../../../webpack-types'
import {getSharedFor} from '../web-resources-lib/shared'
import {generateManifestPatches} from '../web-resources-lib/generate-manifest'

export class PatchManifestWebResources {
  public readonly manifestPath: string
  public readonly excludeList?: FilepathList
  public readonly browser?: string

  constructor(options: {
    manifestPath: string
    excludeList?: FilepathList
    browser?: string
  }) {
    this.manifestPath = options.manifestPath
    this.excludeList = options.excludeList
    this.browser = options.browser
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'plugin-extension:feature-web-resources:patch-manifest',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'plugin-extension:feature-web-resources:patch-manifest',
            stage: Compilation.PROCESS_ASSETS_STAGE_ANALYSE
          },
          () => {
            const shared = getSharedFor(compilation)
            generateManifestPatches(
              compilation,
              this.manifestPath,
              this.excludeList as Record<string, string | string[]> | undefined,
              shared.entryImports || {},
              this.browser
            )
          }
        )
      }
    )
  }
}
