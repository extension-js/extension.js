// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {type Compilation, type Compiler, rspack} from '@rspack/core'
import {isDebug} from '../lib/messaging'
import {checkManifestInPublic} from './check-manifest-in-public'
import {emitRootAbsoluteRefs} from './emit-root-absolute-refs'
import * as messages from './messages'
import {inspectPublicFolders} from './resolve-public-folder'
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
    const inspection = inspectPublicFolders(manifestPath, context)
    // The folder in use, or the canonical root path when there is none, so
    // root-absolute refs keep resolving from the same place as before.
    const publicDir = inspection.publicDir || path.join(context, 'public')

    // Chrome resolves a leading '/' from the extension root; a root-absolute ref
    // public/ does not satisfy is served from the source root instead.
    compiler.hooks.thisCompilation.tap(
      SpecialFoldersPlugin.name,
      (compilation: Compilation) => {
        // Say which folder ships, the way _locales does: a next-to-manifest
        // folder gets the placement note, two folders name the winner.
        if (inspection.bothExist) {
          pushLayoutWarning(
            compiler,
            compilation,
            'PublicFolderShadowedWarning',
            messages.publicFolderShadowed(
              inspection.fromRoot,
              inspection.fromManifest
            )
          )
        } else if (inspection.usedFallback) {
          pushLayoutWarning(
            compiler,
            compilation,
            'PublicLayoutWarning',
            messages.publicMustBeAtProjectRoot(
              inspection.fromManifest,
              inspection.fromRoot
            )
          )
        }
        compilation.hooks.processAssets.tap(
          {
            name: `${SpecialFoldersPlugin.name}:root-absolute-refs`,
            // Late enough that HTML and CSS assets exist to be scanned.
            stage: (
              compilation.constructor as unknown as {
                PROCESS_ASSETS_STAGE_SUMMARIZE: number
              }
            ).PROCESS_ASSETS_STAGE_SUMMARIZE
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

    if (inspection.publicDir) {
      // Guard against dangerous files in public/ that would overwrite generated assets
      compiler.hooks.thisCompilation.tap(
        SpecialFoldersPlugin.name,
        (compilation: Compilation) => {
          compilation.hooks.processAssets.tap(
            {
              name: `${SpecialFoldersPlugin.name}:guards`,
              stage: (
                compilation.constructor as unknown as {
                  PROCESS_ASSETS_STAGE_PRE_PROCESS: number
                }
              ).PROCESS_ASSETS_STAGE_PRE_PROCESS
            },
            () => {
              checkManifestInPublic(compilation, publicDir)
            }
          )
        }
      )

      // Only ignore the root public/manifest.json to avoid overwriting the generated
      // manifest; nested public/**/manifest.json is copied through. The glob
      // matches full paths, so a bare filename here would never exclude it.
      const copyIgnore = [
        path.join(publicDir, 'manifest.json').replace(/\\/g, '/')
      ]

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
      if (isDebug()) {
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

function pushLayoutWarning(
  compiler: Compiler,
  compilation: Compilation,
  name: string,
  message: string
) {
  const ErrorConstructor =
    (compiler as {rspack?: {WebpackError?: typeof Error}} | undefined)?.rspack
      ?.WebpackError || Error
  const warning = new ErrorConstructor(message)
  warning.name = name
  if (!compilation.warnings) compilation.warnings = []
  compilation.warnings.push(warning)
}
