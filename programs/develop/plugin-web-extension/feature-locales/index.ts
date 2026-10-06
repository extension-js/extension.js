// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {Compilation, type Compiler} from '@rspack/core'
import type {DevOptions, FilepathList, PluginInterface} from '../../types'
import * as messages from './messages'
import {processLocaleAssets} from './process-assets'
import {trackLocaleDependencies} from './track-dependencies'
import {validateDefaultLocaleEmitted, validateLocales} from './validation'

export class LocalesPlugin {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList
  }

  public apply(compiler: Compiler): void {
    // Add the locales to the compilation so other plugins can read and modify
    // them via compilation.assets.
    compiler.hooks.thisCompilation.tap('locales:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'locales:module',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          if (!fs.existsSync(this.manifestPath)) {
            const ErrorConstructor = compiler?.rspack?.WebpackError || Error
            const error = new ErrorConstructor(
              messages.manifestNotFoundMessageOnly(this.manifestPath)
            )

            error.name = 'ManifestNotFoundError'
            // @ts-expect-error - file is not a property of Error
            error.file = String(this.manifestPath)

            if (!compilation.errors) {
              compilation.errors = []
            }

            compilation.errors.push(error)

            return
          }

          if (
            !validateLocales(
              compiler,
              compilation,
              this.manifestPath,
              this.browser
            )
          ) {
            return
          }

          if (compilation.errors.length > 0) return

          processLocaleAssets(compiler, compilation, this.manifestPath)
        }
      )

      compilation.hooks.afterProcessAssets.tap('locales:module', () => {
        validateDefaultLocaleEmitted(
          compiler,
          compilation,
          this.manifestPath,
          this.browser
        )
      })
    })

    compiler.hooks.afterCompile.tap('locales:module', (compilation) => {
      const projectRoot =
        (compiler.options.context as string | undefined) || undefined
      trackLocaleDependencies(compilation, this.manifestPath, projectRoot)
    })
  }
}
