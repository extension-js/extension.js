import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler} from '@rspack/core'
import {isDebug} from '../../../lib/messaging'
import type {FilepathList, PluginInterface} from '../../../types'
import * as messages from '../messages'
import {iconValuesToStrings} from '../normalize-keys'

export class AddToFileDependencies {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'icons:add-to-file-dependencies',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'icons:add-to-file-dependencies',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => {
            // Tracked even when this build errored: a missing or broken icon
            // is exactly the file whose fix must trigger the next rebuild.
            const iconFields = this.includeList || {}
            let added = 0
            for (const field of Object.entries(iconFields)) {
              const [, resource] = field
              const stringEntries = iconValuesToStrings(resource)
              for (const entry of stringEntries) {
                if (!entry || !path.isAbsolute(entry)) continue
                if (!fs.existsSync(entry)) {
                  compilation.missingDependencies?.add(entry)
                  continue
                }
                if (!compilation.fileDependencies.has(entry)) {
                  compilation.fileDependencies.add(entry)
                  added++
                }
              }
            }
            if (isDebug()) {
              console.log(messages.iconsDepsTracked(added))
            }
          }
        )
      }
    )
  }
}
