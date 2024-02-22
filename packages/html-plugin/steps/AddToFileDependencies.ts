import fs from 'fs'
import type webpack from 'webpack'
import {Compilation} from 'webpack'

import {type IncludeList, type StepPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

import * as fileUtils from '../helpers/utils'

export default class AddToFileDependencies {
  public readonly manifestPath: string
  public readonly includeList: IncludeList
  public readonly exclude: string[]

  constructor(options: StepPluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.exclude = options.exclude
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'HtmlPlugin (AddToFileDependencies)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'HtmlPlugin (AddToFileDependencies)',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (compilation.errors?.length) return

            const manifestSource = fileUtils.getManifestContent(
              compilation,
              this.manifestPath
            )

            const allEntries = {
              ...manifestFields(this.manifestPath, manifestSource).html,
              ...this.includeList
            }

            for (const field of Object.entries(allEntries)) {
              const [, resource] = field

              if (resource?.html) {
                const fileDependencies = new Set(compilation.fileDependencies)

                if (fs.existsSync(resource?.html)) {
                  const fileResources = [resource?.html, ...resource?.static]

                  for (const thisResource of fileResources) {
                    if (!fileDependencies.has(thisResource)) {
                      fileDependencies.add(thisResource)

                      if (thisResource === resource?.html) {
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
