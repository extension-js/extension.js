// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import rspack, {Compilation, type Compiler, sources} from '@rspack/core'
import {readManifestText} from '../../../lib/manifest/source-manifest'
import {debugLine, humanLine, isDebug} from '../../../lib/messaging'
import {hasJsonComments, parseAuthoredJson} from '../../../lib/parse-json-safe'
import type {PluginInterface} from '../../../types'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
import * as messages from '../messages'

export class EmitManifest {
  public readonly manifestPath: string
  private readonly browser?: string
  private reportedComments = false

  constructor(options: PluginInterface & {browser?: string}) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser ? String(options.browser) : undefined
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
            let hadComments = false

            try {
              const content = readManifestText(this.manifestPath)
              jsonContent = parseAuthoredJson(content, {browser: this.browser})
              hadComments = hasJsonComments(content)

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

            compilation.emitAsset(
              'manifest.json',
              new sources.RawSource(jsonString)
            )

            // Said once per session: a dev rebuild would repeat it on every save.
            if (hadComments && !this.reportedComments) {
              this.reportedComments = true
              humanLine(messages.manifestCommentsRemoved())
            }

            if (isDebug()) {
              debugLine(messages.manifestEmitSuccess())
            }
          }
        )
      }
    )
  }
}
