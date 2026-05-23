// ██╗ ██████╗ ██████╗ ███╗   ██╗███████╗
// ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝
// ██║██║     ██║   ██║██╔██╗ ██║███████╗
// ██║██║     ██║   ██║██║╚██╗██║╚════██║
// ██║╚██████╗╚██████╔╝██║ ╚████║███████║
// ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {type Compiler, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../types'
import {iconValuesToStrings} from '../normalize-keys'
import * as messages from '../messages'

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
            if (compilation.errors?.length) return

            const iconFields = this.includeList || {}
            let added = 0

            for (const field of Object.entries(iconFields)) {
              const [, resource] = field

              const stringEntries = iconValuesToStrings(resource)

              for (const entry of stringEntries) {
                if (
                  entry &&
                  fs.existsSync(entry) &&
                  !compilation.fileDependencies.has(entry)
                ) {
                  compilation.fileDependencies.add(entry)
                  added++
                }
              }
            }

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(messages.iconsDepsTracked(added))
            }
          }
        )
      }
    )
  }
}
