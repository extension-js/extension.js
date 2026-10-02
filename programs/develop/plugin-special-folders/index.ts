// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, type Compiler, rspack} from '@rspack/core'
import {isDebug} from '../lib/messaging'
import type {SpecialFoldersConfig} from '../types'
import {checkManifestInPublic} from './check-manifest-in-public'
import {explainPublicOutputCollision} from './check-public-output-collision'
import {emitRootAbsoluteRefs} from './emit-root-absolute-refs'
import {
  publicFolderSetting,
  rememberSpecialFoldersConfig
} from './folders-config'
import * as messages from './messages'
import {
  inspectPublicFolders,
  rememberPublicRoots
} from './resolve-public-folder'
import {WarnUponFolderChanges} from './warn-upon-folder-changes'

interface SpecialFoldersPluginOptions {
  manifestPath: string
  folders?: SpecialFoldersConfig
}

export class SpecialFoldersPlugin {
  public static readonly name: string = 'plugin-special-folders'

  private readonly options: SpecialFoldersPluginOptions

  constructor(options: SpecialFoldersPluginOptions) {
    this.options = options
  }

  apply(compiler: Compiler) {
    const {manifestPath, folders} = this.options
    const context = compiler.options.context || path.dirname(manifestPath)
    if (folders) rememberSpecialFoldersConfig(context, folders)

    const inspection = inspectPublicFolders(manifestPath, context)
    // Every project but one ships from a public folder, whether or not that
    // folder exists yet. `folders: {public: false}` reads none.
    const readsPublicFolder = publicFolderSetting(context).kind !== 'off'
    // The folder in use, or the canonical location when there is none, so
    // root-absolute refs keep resolving from the same place as before.
    const publicDir = inspection.publicDir || inspection.fromRoot
    // The reload classifier asks for this root later, from the compilation.
    rememberPublicRoots(compiler, readsPublicFolder ? [publicDir] : [])

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
              inspection.fromManifest,
              context
            )
          )
        } else if (inspection.usedFallback) {
          pushLayoutWarning(
            compiler,
            compilation,
            'PublicLayoutWarning',
            messages.publicMustBeAtProjectRoot(
              inspection.fromManifest,
              inspection.fromRoot,
              context
            )
          )
        }

        compilation.hooks.processAssets.tapPromise(
          {
            name: `${SpecialFoldersPlugin.name}:root-absolute-refs`,
            // Late enough that HTML and CSS assets exist to be scanned.
            stage: (
              compilation.constructor as unknown as {
                PROCESS_ASSETS_STAGE_SUMMARIZE: number
              }
            ).PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () =>
            // Root refs resolve from the EXTENSION root (the manifest dir),
            // which is not always the compiler context / package.json dir.
            emitRootAbsoluteRefs(
              compilation,
              path.dirname(manifestPath),
              publicDir
            )
        )
      }
    )

    // Gated, never unconditional: the collision explainer below resolves a
    // public path even when nothing reads the folder, so a folder left on disk
    // under `public: false` would be blamed for a clash between two generated
    // entries.
    if (readsPublicFolder) {
      const watching = Boolean(compiler.options.watchOptions)

      // Guard against dangerous files in public/ that would overwrite generated assets
      compiler.hooks.thisCompilation.tap(
        SpecialFoldersPlugin.name,
        (compilation: Compilation) => {
          // A file only the copier ships (a DNR ruleset, a fetched data file)
          // has no module or manifest reference to watch it, so watch the folder.
          // A folder that is not there yet is watched through its parent, so
          // creating it mid-session is a change the next compile acts on.
          const folderToWatch = fs.existsSync(publicDir)
            ? publicDir
            : watching
              ? path.dirname(publicDir)
              : undefined

          if (folderToWatch) compilation.contextDependencies?.add(folderToWatch)

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

          // Runs last on purpose: the collision is raised while assets are
          // emitted, so the earlier guard stage cannot see it yet.
          compilation.hooks.processAssets.tap(
            {
              name: `${SpecialFoldersPlugin.name}:collisions`,
              stage: (
                compilation.constructor as unknown as {
                  PROCESS_ASSETS_STAGE_REPORT: number
                }
              ).PROCESS_ASSETS_STAGE_REPORT
            },
            () => {
              explainPublicOutputCollision(compilation, publicDir)
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
