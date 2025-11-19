import {Compilation, Compiler} from '@rspack/core'
import {collectContentScriptEntryImports} from '../collect-entry-imports'
import type {FilepathList} from '../../../webpack-types'
import {getSharedFor} from '../web-resources-lib/shared'
import {entryImportsSummary} from '../web-resources-lib/messages'

export class CollectContentEntryImports {
  public readonly includeList?: FilepathList

  constructor(options: {manifestPath: string; includeList?: FilepathList}) {
    this.includeList = options.includeList
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'plugin-extension:feature-web-resources:collect-entry-imports',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'plugin-extension:feature-web-resources:collect-entry-imports',
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () => {
            const entryImports = collectContentScriptEntryImports(
              compilation,
              this.includeList
            )
            const shared = getSharedFor(compilation)
            shared.entryImports = entryImports

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              const keys = Object.keys(entryImports || {})
              const total = keys.reduce(
                (acc, k) => acc + ((entryImports as any)[k]?.length || 0),
                0
              )
              console.log(entryImportsSummary(keys.length, total))
            }
          }
        )
      }
    )
  }
}
