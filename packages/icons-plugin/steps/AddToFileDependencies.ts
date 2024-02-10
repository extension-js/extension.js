import fs from 'fs'
import webpack, {Compilation} from 'webpack'
import {type IconsPluginInterface} from '../types'

// Manifest fields
import manifestFields from 'browser-extension-manifest-fields'

export default class AddToFileDependencies {
  private readonly manifestPath: string
  public readonly exclude?: string[]

  constructor(options: IconsPluginInterface) {
    this.manifestPath = options.manifestPath
    this.exclude = options.exclude
  }

  public apply(compiler: webpack.Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'IconsPlugin (AddToFileDependencies)',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'IconsPlugin (AddToFileDependencies)',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          (assets) => {
            if (compilation.errors?.length) return

            const manifest = assets['manifest.json']
              ? JSON.parse(assets['manifest.json'].source().toString())
              : require(this.manifestPath)

            const iconFields = manifestFields(this.manifestPath, manifest).icons

            for (const field of Object.entries(iconFields)) {
              const [, resource] = field

              const iconEntries = Array.isArray(resource)
                ? typeof resource[0] === 'string'
                  ? resource
                  : resource.map(Object.values).flat()
                : [resource]

              for (const entry of iconEntries) {
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
