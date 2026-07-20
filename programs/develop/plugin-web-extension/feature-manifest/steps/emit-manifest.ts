// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import rspack, {Compilation, type Compiler, sources} from '@rspack/core'
import {stripBom} from '../../../lib/parse-json-safe'
import type {PluginInterface} from '../../../types'
import {
  setCurrentManifestContent,
  setOriginalManifestContent
} from '../manifest-lib/manifest'
import * as messages from '../messages'

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
            let jsonContent: Record<string, unknown>

            try {
              const content = fs.readFileSync(this.manifestPath, 'utf-8')
              jsonContent = JSON.parse(stripBom(content))

              if ('$schema' in jsonContent) {
                delete jsonContent.$schema
              }
            } catch (error) {
              const err = new rspack.WebpackError(
                messages.manifestInvalidError(error as NodeJS.ErrnoException)
              ) as Error & {file?: string}
              err.file = 'manifest.json'
              compilation.errors.push(err)
              return
            }

            // Keep the sanitized source manifest available to later plugins;
            // UpdateManifest is the single canonical writer of browser-specific fields.
            const jsonString = JSON.stringify(jsonContent, null, 2)
            setOriginalManifestContent(compilation, jsonString)
            setCurrentManifestContent(compilation, jsonString)

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
