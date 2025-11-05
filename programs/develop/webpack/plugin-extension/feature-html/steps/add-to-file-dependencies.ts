import * as fs from 'fs'
import {type Compiler} from '@rspack/core'
import {Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {getAssetsFromHtml} from '../html-lib/utils'

export class AddToFileDependencies {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = {}
    this.browser = options.browser
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'html:add-to-file-dependencies',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'html:add-to-file-dependencies',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => {
            if (compilation.errors?.length) return

            const allEntries = this.includeList || {}

            for (const field of Object.entries(allEntries)) {
              const [, resource] = field

              if (resource) {
                const resourceData = getAssetsFromHtml(resource as string)
                const fileDependencies = new Set(compilation.fileDependencies)

                if (fs.existsSync(resource as string)) {
                  const fileResources = [
                    resource as string,
                    ...(resourceData?.static || [])
                  ]

                  for (const thisResource of fileResources) {
                    if (!fileDependencies.has(thisResource)) {
                      fileDependencies.add(thisResource)

                      if (thisResource === resource) {
                        compilation.fileDependencies.add(thisResource)
                      }
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
