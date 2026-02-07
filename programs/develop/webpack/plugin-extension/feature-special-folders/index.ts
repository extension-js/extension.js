// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'
import {type Compiler, type Compilation, rspack} from '@rspack/core'
import {WarnUponFolderChanges} from './warn-upon-folder-changes'
import {checkManifestInPublic} from './check-manifest-in-public'
import * as messages from './messages'

interface SpecialFoldersPluginOptions {
  manifestPath: string
}

/**
 * SpecialFoldersPlugin is responsible for handling the
 * three types of special folders in the extension:
 *
 * - /pages - HTML pages not included in the manifest
 * - /scripts - Script files not included in the manifest
 * - /public - Static files not included in the manifest
 */
export class SpecialFoldersPlugin {
  public static readonly name: string = 'plugin-special-folders'

  private readonly options: SpecialFoldersPluginOptions

  constructor(options: SpecialFoldersPluginOptions) {
    this.options = options
  }

  apply(compiler: Compiler) {
    const {manifestPath} = this.options
    const context = compiler.options.context || path.dirname(manifestPath)
    const publicDir = path.join(context, 'public')

    // If there is no exact 'public' directory, do nothing here.
    if (fs.existsSync(publicDir) && fs.statSync(publicDir).isDirectory()) {
      // Guard against dangerous files in public/ that would overwrite generated assets
      compiler.hooks.thisCompilation.tap(
        SpecialFoldersPlugin.name,
        (compilation: Compilation) => {
          compilation.hooks.processAssets.tap(
            {
              name: `${SpecialFoldersPlugin.name}:guards`,
              stage: (compilation.constructor as any)
                .PROCESS_ASSETS_STAGE_PRE_PROCESS
            },
            () => {
              checkManifestInPublic(compilation, publicDir)
            }
          )
        }
      )

      // Use Rspack's CopyRspackPlugin by default to mirror public/ into the output root
      new rspack.CopyRspackPlugin({
        patterns: [
          {
            from: publicDir,
            to: '.',
            noErrorOnMissing: true,
            globOptions: {
              // Only ignore the root public/manifest.json to avoid overwriting
              // the generated manifest. Nested public/**/manifest.json should
              // be copied through (e.g., templates/assets).
              ignore: ['manifest.json']
            }
          }
        ]
      }).apply(compiler)
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          messages.specialFoldersSetupSummary(
            true,
            true,
            ['**/manifest.json'].length
          )
        )
      }
    }

    if (compiler.options.mode === 'development') {
      if (compiler.options.watchOptions) {
        new WarnUponFolderChanges().apply(compiler)
      }
    }
  }
}
