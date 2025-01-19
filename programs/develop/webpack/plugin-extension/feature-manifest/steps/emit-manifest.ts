import fs from 'fs'
import webpack, {Compiler, Compilation} from 'webpack'
import {sources} from 'webpack'
import * as messages from '../../../lib/messages'
import {type PluginInterface} from '../../../webpack-types'

export class EmitManifest {
  public readonly manifestPath: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'manifest:emit-manifest',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:emit-manifest',
            stage: Compilation.PROCESS_ASSETS_STAGE_PRE_PROCESS
          },
          () => {
            const manifestPath = this.manifestPath
            let jsonContent: Record<string, any>

            try {
              // Read and parse the manifest file
              const content = fs.readFileSync(manifestPath, 'utf-8')
              jsonContent = JSON.parse(content)

              // Remove the $schema field if it exists
              if ('$schema' in jsonContent) {
                delete jsonContent['$schema']
              }
            } catch (error: any) {
              compilation.errors.push(
                new webpack.WebpackError(messages.manifestInvalidError(error))
              )
              return
            }

            // Stringify the JSON without $schema
            const jsonString = JSON.stringify(jsonContent, null, 2)

            // Emit the modified JSON file
            const outputFilename = 'manifest.json'
            compilation.emitAsset(
              outputFilename,
              new sources.RawSource(jsonString)
            )
          }
        )
      }
    )
  }
}
