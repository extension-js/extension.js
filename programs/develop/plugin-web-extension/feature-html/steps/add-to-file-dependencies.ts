// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import type {Compiler} from '@rspack/core'
import {Compilation} from '@rspack/core'
import type {FilepathList, PluginInterface} from '../../../types'
import {getAssetsFromHtml} from '../html-lib/utils'

export class AddToFileDependencies {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
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
                const fileDependencies = new Set(compilation.fileDependencies)

                // Parse only files that exist: getAssetsFromHtml throws on a
                // deleted HTML entry instead of reporting an empty page.
                if (fs.existsSync(resource as string)) {
                  const resourceData = getAssetsFromHtml(resource as string)
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
