import * as fs from 'fs'
import {type Compiler, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'

export class AddToFileDependencies {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = {}
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

            for (const field of Object.entries(iconFields)) {
              const [, resource] = field

              const iconEntries: unknown[] = Array.isArray(resource)
                ? typeof resource[0] === 'string'
                  ? resource
                  : resource.map(Object.values).flat()
                : [resource]

              const stringEntries = iconEntries.filter(
                (entry): entry is string => typeof entry === 'string'
              )

              for (const entry of stringEntries) {
                if (entry) {
                  const fileDependencies = new Set(compilation.fileDependencies)

                  if (fs.existsSync(entry)) {
                    if (!fileDependencies.has(entry)) {
                      fileDependencies.add(entry)
                      compilation.fileDependencies.add(entry)
                    }
                  }
                }
              }
            }
          }
        )
      }
    )
  }
}
