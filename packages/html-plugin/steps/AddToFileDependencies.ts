import fs from 'fs'
import webpack, {Compilation} from 'webpack'

import {type HtmlPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

export default class AddToFileDependencies {
  public readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: HtmlPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude || []
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'BrowserExtensionAddToFileDependencies',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'BrowserExtensionAddToFileDependencies4',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (compilation.errors?.length) return

            const manifestSource = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)

            const htmlFields = manifestFields(
              this.manifestPath,
              manifestSource
            ).html

            for (const field of Object.entries(htmlFields)) {
              const [, resource] = field

              if (resource?.html) {
                const fileDependencies = new Set(compilation.fileDependencies)

                if (fs.existsSync(resource?.html)) {
                  const fileResources = [resource?.html, ...resource?.static]

                  for (const thisResource of fileResources) {
                    if (!fileDependencies.has(thisResource)) {
                      fileDependencies.add(thisResource)
                      compilation.fileDependencies.add(thisResource)
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
