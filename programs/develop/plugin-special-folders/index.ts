// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {type Compilation, type Compiler, rspack} from '@rspack/core'
import * as fs from 'fs'
import * as path from 'path'
import {checkManifestInPublic} from './check-manifest-in-public'
import {emitRootAbsoluteRefs} from './emit-root-absolute-refs'
import * as messages from './messages'
import {WarnUponFolderChanges} from './warn-upon-folder-changes'

interface SpecialFoldersPluginOptions {
  manifestPath: string
}

/**
 * SpecialFoldersPlugin is responsible for handling the
 * special folders in the extension:
 *
 * - /pages - HTML pages not included in the manifest
 * - /scripts - Script files not included in the manifest
 * - /public - Static files not included in the manifest
 * - /extensions - Load-only companion extensions (unpacked)
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

    // Chrome resolves a leading '/' from the extension root, so a root-absolute
    // ref that public/ does not satisfy is served from the source root instead.
    // Runs whether or not public/ exists, projects with NO public/ dir are
    // exactly the ones that were broken.
    compiler.hooks.thisCompilation.tap(
      SpecialFoldersPlugin.name,
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: `${SpecialFoldersPlugin.name}:root-absolute-refs`,
            // Late enough that HTML and CSS assets exist to be scanned.
            stage: (compilation.constructor as any)
              .PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () => {
            // Root refs resolve from the EXTENSION root (the manifest dir),
            // which is not always the compiler context / package.json dir.
            emitRootAbsoluteRefs(
              compilation,
              path.dirname(manifestPath),
              publicDir
            )
          }
        )
      }
    )

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

      // Only ignore the root public/manifest.json to avoid overwriting the
      // generated manifest. Nested public/**/manifest.json should be copied
      // through (e.g., templates/assets)
      const copyIgnore = ['manifest.json']

      // Use Rspack's CopyRspackPlugin by default to mirror public/ into the output root
      new rspack.CopyRspackPlugin({
        patterns: [
          {
            from: publicDir,
            to: '.',
            noErrorOnMissing: true,
            globOptions: {
              ignore: copyIgnore
            }
          }
        ]
      }).apply(compiler)
      if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
        console.log(
          messages.specialFoldersSetupSummary(true, true, copyIgnore.length)
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
