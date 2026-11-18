// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, rspack} from '@rspack/core'
import {requestDevSessionRestart} from '../dev-server/session-restart'
import {debugLine, isDebug} from '../lib/messaging'
import {isInsidePath} from '../lib/real-path'
import {localeDirsWithoutMessages} from '../plugin-web-extension/feature-locales/get-locales'
import type {
  DevOptions,
  ExcludeFilesConfig,
  IncludeFilesConfig,
  SpecialFoldersConfig
} from '../types'
import {checkManifestInPublic} from './check-manifest-in-public'
import {explainPublicOutputCollision} from './check-public-output-collision'
import {htmlPageEntries} from '../plugin-web-extension/shared/html-page-entries'
import {getResolvedManifestFieldsData} from '../plugin-web-extension/shared/manifest-fields'
import {emitRootAbsoluteRefs} from './emit-root-absolute-refs'
import {
  excludedFiles,
  publicFolderSetting,
  rememberExcludedFiles,
  rememberSpecialFoldersConfig
} from './folders-config'
import {
  getSpecialFoldersDataForCompiler,
  walkedScriptsLeftOut
} from './get-data'
import {HintImportOnlyScripts} from './hint-import-only-scripts'
import {IncludeFiles} from './include-files'
import * as messages from './messages'
import {PruneRemovedPublicFiles} from './prune-removed-public-files'
import {
  findPublicEnvFiles,
  literalPathGlob,
  privateFileIgnoreGlobs
} from './public-private-files'
import {
  inspectPublicFolders,
  rememberPublicRoots
} from './resolve-public-folder'
import {WarnUponFolderChanges} from './warn-upon-folder-changes'

// The env files a watch session already named, by public folder. It
// outlives a compiler, so a session restart does not say them again.
const saidEnvFiles = new Map<string, string>()

// The same for the scripts/ files a session named as left out, by project.
const saidLeftOutScripts = new Map<string, string>()

interface SpecialFoldersPluginOptions {
  manifestPath: string
  browser?: DevOptions['browser']
  folders?: SpecialFoldersConfig
  include?: IncludeFilesConfig
  exclude?: ExcludeFilesConfig
}

// The source file of each page the build emits, from the list the page step
// emits them from. Read once a withheld ref asks, and once per compilation.
function pageSources(
  compiler: Compiler,
  manifestPath: string,
  browser: DevOptions['browser']
): (assetName: string) => string | undefined {
  let pages: Map<string, string> | undefined

  return (assetName) => {
    if (!pages) {
      const projectPath = compiler.options.context || path.dirname(manifestPath)
      const fields = getResolvedManifestFieldsData({
        manifestPath,
        browser,
        projectPath
      })
      const entries = htmlPageEntries({
        manifestPath,
        browser,
        projectPath,
        mode: compiler.options.mode,
        manifestHtml: fields.html,
        manifestScripts: fields.scripts,
        specialFolderPages: getSpecialFoldersDataForCompiler(compiler).pages
      })

      pages = new Map()

      for (const [feature, file] of Object.entries(entries)) {
        if (typeof file === 'string' && file) {
          pages.set(
            `${feature}.html`,
            path.resolve(path.dirname(manifestPath), file)
          )
        }
      }
    }

    return pages.get(assetName)
  }
}

export class SpecialFoldersPlugin {
  public static readonly name: string = 'plugin-special-folders'

  private readonly options: SpecialFoldersPluginOptions

  constructor(options: SpecialFoldersPluginOptions) {
    this.options = options
  }

  apply(compiler: Compiler) {
    const {manifestPath, browser, folders, include, exclude} = this.options
    const context = compiler.options.context || path.dirname(manifestPath)
    if (folders) rememberSpecialFoldersConfig(context, folders)
    if (exclude) rememberExcludedFiles(context, exclude)

    // Declared files ride the same copier as public/, so they land in the
    // output and reload on edit without a plugin of the project's own.
    new IncludeFiles({include, projectRoot: context}).apply(compiler)

    new HintImportOnlyScripts().apply(compiler)

    // A file put in scripts/ is expected in the output, so one the build
    // leaves out is said once, and in a watch session when the list changes.
    compiler.hooks.thisCompilation.tap(
      SpecialFoldersPlugin.name,
      (compilation: Compilation) => {
        const leftOut = walkedScriptsLeftOut(context)
        const key = leftOut.join('\n')
        const alreadySaid =
          compiler.watchMode && saidLeftOutScripts.get(context) === key

        if (compiler.watchMode) saidLeftOutScripts.set(context, key)

        if (leftOut.length > 0 && !alreadySaid) {
          pushLayoutWarning(
            compiler,
            compilation,
            'ScriptsFolderFilesLeftOutWarning',
            messages.scriptsFolderFilesLeftOut(
              leftOut,
              String(browser || 'chrome')
            )
          )
        }
      }
    )

    const excluded = excludedFiles(context)

    // An excluded path with no file behind it is a typo more often than not,
    // and the page it meant to leave out ships without a word otherwise.
    if (excluded.size > 0) {
      compiler.hooks.thisCompilation.tap(
        SpecialFoldersPlugin.name,
        (compilation: Compilation) => {
          for (const file of excluded) {
            if (fs.existsSync(file)) continue

            pushLayoutWarning(
              compiler,
              compilation,
              'ExcludeFilesWarning',
              messages.excludeEntryMissing(
                path.relative(context, file).split(path.sep).join('/'),
                String(browser || 'chrome')
              )
            )
          }
        }
      )
    }

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
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () =>
            // Root refs resolve from the EXTENSION root (the manifest dir),
            // which is not always the compiler context / package.json dir.
            emitRootAbsoluteRefs(
              compilation,
              path.dirname(manifestPath),
              publicDir,
              !readsPublicFolder,
              context,
              pageSources(compiler, manifestPath, browser || 'chrome')
            )
        )
      }
    )

    // Gated, never unconditional: the collision explainer below resolves a
    // public path even when nothing reads the folder, so a folder left on disk
    // under `public: false` would be blamed for a clash between two generated
    // entries.
    if (readsPublicFolder) {
      // The copier only takes a folder that exists: pointed at one that does
      // not, it watches the whole project root instead, and a screenshot or
      // a demo page written anywhere in the project rebuilt and reloaded.
      const copierWired = fs.existsSync(publicDir)
      let pickupRequested = false

      // Guard against dangerous files in public/ that would overwrite generated assets
      compiler.hooks.thisCompilation.tap(
        SpecialFoldersPlugin.name,
        (compilation: Compilation) => {
          // The copier watches the folder it reads. One that is not there yet
          // is watched by its own path, so creating it triggers a compile.
          if (!fs.existsSync(publicDir)) {
            compilation.missingDependencies?.add(publicDir)
          } else if (!copierWired) {
            compilation.contextDependencies?.add(publicDir)
          }

          // A folder that appeared mid-session needs the copier the session
          // started without, so the session restarts the way it does for a new
          // page or script entry.
          if (!copierWired && !pickupRequested && fs.existsSync(publicDir)) {
            pickupRequested = true

            if (
              !requestDevSessionRestart(compiler, {
                reason: 'public',
                pathAfter: publicDir
              })
            ) {
              pushLayoutWarning(
                compiler,
                compilation,
                'PublicFolderAppearedWarning',
                messages.publicFolderAppeared(publicDir, context)
              )
            }
          }

          // An env file was put there on purpose, so leaving it out is said:
          // once per build, and in a watch session only when the list changes.
          const envFiles = findPublicEnvFiles(publicDir).map((file) =>
            path.posix.join(path.basename(publicDir), file)
          )
          const envKey = envFiles.join('\n')
          const alreadySaid =
            compiler.watchMode && saidEnvFiles.get(publicDir) === envKey

          if (compiler.watchMode) saidEnvFiles.set(publicDir, envKey)

          if (envFiles.length > 0 && !alreadySaid) {
            pushLayoutWarning(
              compiler,
              compilation,
              'PublicEnvFilesWarning',
              messages.publicEnvFilesLeftOut(
                envFiles,
                String(browser || 'chrome')
              )
            )
          }

          compilation.hooks.processAssets.tap(
            {
              name: `${SpecialFoldersPlugin.name}:guards`,
              stage: Compilation.PROCESS_ASSETS_STAGE_PRE_PROCESS
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
              stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
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
      // A locale folder that has no messages.json stays out as well (the
      // locales plugin names it in a warning).
      const publicLocales = path.join(publicDir, '_locales')
      const copyIgnore = [
        literalPathGlob(path.join(publicDir, 'manifest.json')),
        // The package is readable by anyone who installs the extension, so
        // OS metadata, env files and repository files never enter it.
        ...privateFileIgnoreGlobs(publicDir),
        ...localeDirsWithoutMessages(publicLocales).map(
          (dir) => `${literalPathGlob(dir)}/**`
        ),
        // A public file the `exclude` config names stays out of this build.
        ...[...excluded]
          .filter((file) => isUnderDir(file, publicDir))
          .map(literalPathGlob)
      ]

      if (copierWired) {
        new rspack.CopyRspackPlugin({
          patterns: [
            {
              from: publicDir,
              to: '.',
              noErrorOnMissing: true,
              // A copied file ships as authored. A minifier drops the value
              // a script ends on and the comment that names its source map.
              info: {minimized: true},
              globOptions: {
                ignore: copyIgnore
              }
            }
          ]
        }).apply(compiler)
      }

      const watching = Boolean(compiler.options.watchOptions)

      if (watching && compiler.options.mode === 'development') {
        new PruneRemovedPublicFiles(publicDir).apply(compiler)
      }

      if (isDebug()) {
        debugLine(
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

function isUnderDir(file: string, dir: string): boolean {
  return isInsidePath(dir, file)
}

function pushLayoutWarning(
  compiler: Compiler,
  compilation: Compilation,
  name: string,
  message: string
) {
  const warning = new compiler.rspack.WebpackError(message)
  warning.name = name
  if (!compilation.warnings) compilation.warnings = []

  compilation.warnings.push(warning)
}
