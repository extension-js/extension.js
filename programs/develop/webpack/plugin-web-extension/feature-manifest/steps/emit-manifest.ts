// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import rspack, {sources, Compiler, Compilation} from '@rspack/core'
import * as messages from '../messages'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
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
            let jsonContent: Record<string, any>

            try {
              // Read and parse the manifest file
              const content = fs.readFileSync(this.manifestPath, 'utf-8')
              jsonContent = JSON.parse(content)

              // Remove the $schema field if it exists
              if ('$schema' in jsonContent) {
                delete jsonContent['$schema']
              }
            } catch (error: any) {
              const err = new rspack.WebpackError(
                messages.manifestInvalidError(error)
              ) as Error & {file?: string}
              err.file = 'manifest.json'
              compilation.errors.push(err)
              return
            }

            // Keep the sanitized source manifest available to later plugins without
            // losing the original author intent. UpdateManifest is the single
            // canonical writer that rewrites browser-specific fields and paths.
            const jsonString = JSON.stringify(jsonContent, null, 2)
            setOriginalManifestContent(compilation, jsonString)

            compilation.emitAsset(
              'manifest.json',
              new sources.RawSource(jsonString)
            )

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(messages.manifestEmitSuccess())
            }
          }
        )
      }
    )
  }
}
