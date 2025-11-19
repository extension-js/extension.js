import * as path from 'path'
import * as fs from 'fs'
import {type Compiler, type Compilation, rspack} from '@rspack/core'
import {WarnUponFolderChanges} from './warn-upon-folder-changes'
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
              try {
                const manifestInPublic = path.join(publicDir, 'manifest.json')
                if (fs.existsSync(manifestInPublic)) {
                  const ErrCtor = (compilation.compiler as any).webpack
                    ?.WebpackError
                  const err = new ErrCtor(
                    `manifest.json must not be placed under public/: ${manifestInPublic}`
                  ) as Error & {file?: string}
                  err.file = 'manifest.json'
                  compilation.errors.push(err)
                }
              } catch {
                // ignore guard errors
              }
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
              ignore: ['**/manifest.json']
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
