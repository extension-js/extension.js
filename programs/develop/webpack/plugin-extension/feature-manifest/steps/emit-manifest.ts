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
    compiler.hooks.compilation.tap(
      'manifest:emit-manifest',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:emit-manifest',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => {
            // Read and parse the JSON file
            const manifestPath = this.manifestPath
            let jsonContent: object

            try {
              const content = fs.readFileSync(manifestPath, 'utf-8')
              jsonContent = JSON.parse(content)
            } catch (error: any) {
              compilation.errors.push(
                new webpack.WebpackError(messages.manifestInvalidError(error))
              )
              return
            }

            // Stringify the JSON content
            const jsonString = JSON.stringify(jsonContent, null, 2)

            // Emit the JSON file
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
