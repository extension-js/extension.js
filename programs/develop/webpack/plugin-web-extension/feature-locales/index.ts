// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {Compiler, Compilation} from '@rspack/core'
import * as messages from './messages'
import {validateLocales} from './validation'
import {processLocaleAssets} from './process-assets'
import {trackLocaleDependencies} from './track-dependencies'
import {type FilepathList, type PluginInterface} from '../../webpack-types'

/**
 * LocalesPlugin is responsible for emitting the locales files
 * to the output directory.
 */
export class LocalesPlugin {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
  }

  public apply(compiler: Compiler): void {
    // Add the locales to the compilation. This is important so other
    // plugins can get it via the compilation.assets object,
    // allowing them to modify it.
    compiler.hooks.thisCompilation.tap('locales:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'locales:module',
          // Add additional assets to the compilation.
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          // Do not emit if manifest doesn't exist.
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

          // Validate locales/default_locale consistency across browsers
          if (!validateLocales(compiler, compilation, this.manifestPath)) {
            return
          }

          if (compilation.errors.length > 0) return

          // Process and emit locale assets
          processLocaleAssets(compiler, compilation, this.manifestPath)
        }
      )
    })

    // Ensure this locales file and its assets are stored as file
    // dependencies so webpack can watch and trigger changes.
    compiler.hooks.thisCompilation.tap('locales:module', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'locales:module',
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
        },
        () => {
          trackLocaleDependencies(compilation, this.manifestPath)
        }
      )
    })
  }
}
