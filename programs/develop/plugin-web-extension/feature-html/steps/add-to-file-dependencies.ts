// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compiler} from '@rspack/core'
import {Compilation} from '@rspack/core'
import {isOsPathUnder} from '../../../lib/real-path'
import {publicContainmentRoot} from '../../../lib/special-folders/resolve-public-folder'
import type {FilepathList, PluginInterface} from '../../../types'
import {isFolder} from '../../shared/paths'
import {
  missingSourceWouldShip,
  sourceMayShip
} from '../html-lib/source-may-ship'
import {
  getAssetsFromHtml,
  isHttpLike,
  isSpecialScheme,
  missingPageEntryFiles,
  resolveAbsoluteFsPath
} from '../html-lib/utils'

export class AddToFileDependencies {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'html:add-to-file-dependencies',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'html:add-to-file-dependencies',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONS
          },
          () => {
            // Tracked even when this build errored: the page and the files it
            // names are what a fix edits, and that save must rebuild.
            const manifestDir = path.dirname(this.manifestPath)
            const projectRoot =
              (compiler.options.context as string) || path.dirname(manifestDir)
            const publicDir = publicContainmentRoot(
              this.manifestPath,
              projectRoot
            )
            const outputRoot = compilation.options?.output?.path || ''

            // A file the build never copies is not read, so it is not
            // watched either. The emit step asks the same question.
            const track = (file: string, rootRef?: string): boolean => {
              if (!file || !path.isAbsolute(file)) return false

              // Not there yet: watched as missing, so creating it rebuilds.
              if (!fs.existsSync(file)) {
                if (missingSourceWouldShip(file, projectRoot, manifestDir)) {
                  compilation.missingDependencies?.add(file)
                }

                return false
              }

              if (
                isFolder(file) ||
                !sourceMayShip(file, projectRoot, manifestDir, {
                  rootRef,
                  publicDir
                })
              ) {
                return false
              }

              compilation.fileDependencies.add(file)

              return true
            }

            const isLocal = (ref: string) =>
              Boolean(ref) &&
              !isHttpLike(ref) &&
              !isSpecialScheme(ref) &&
              !path.basename(ref).startsWith('#')

            const pages = new Set(
              Object.values(this.includeList || {}).filter(
                (resource): resource is string => typeof resource === 'string'
              )
            )

            for (const page of pages) {
              // Parse only files that exist: getAssetsFromHtml throws on a
              // deleted HTML entry instead of reporting an empty page.
              if (!fs.existsSync(page)) continue

              compilation.fileDependencies.add(page)

              // A script or stylesheet with no file is left out of the page
              // entry, so the bundler never watches for it. Creating it has
              // to rebuild for the restart notice to reach the author.
              for (const file of missingPageEntryFiles(page, projectRoot)) {
                if (missingSourceWouldShip(file, projectRoot, manifestDir)) {
                  compilation.missingDependencies?.add(file)
                }
              }

              const parsed = getAssetsFromHtml(page)

              for (const ref of new Set(parsed?.static || [])) {
                if (!isLocal(ref)) continue

                // Resolved the way the emit step resolves it, so a root URL
                // watches the public or the manifest-relative file.
                const {absoluteFsPath, isRootUrl} = resolveAbsoluteFsPath({
                  asset: ref,
                  projectRoot,
                  publicRootForResource: publicDir,
                  outputRoot,
                  manifestRoot: manifestDir
                })
                const authored = parsed?.authored?.[ref] || ref
                const asRootUrl =
                  isRootUrl ||
                  (authored.startsWith('/') && !isOsPathUnder(projectRoot, ref))

                const tracked = track(
                  absoluteFsPath,
                  asRootUrl ? ref : undefined
                )

                // A nested page is copied with the files it names, so those
                // are watched too. A page of the include list has its own turn.
                if (
                  !tracked ||
                  !/\.html?$/i.test(absoluteFsPath) ||
                  pages.has(absoluteFsPath)
                ) {
                  continue
                }

                const nested = getAssetsFromHtml(absoluteFsPath)

                for (const nestedRef of new Set([
                  ...(nested?.js || []),
                  ...(nested?.css || []),
                  ...(nested?.static || [])
                ])) {
                  // A leading slash names a path inside the extension,
                  // which the public folder's own watcher answers for.
                  if (
                    isLocal(nestedRef) &&
                    !(nested?.authored?.[nestedRef] || nestedRef).startsWith(
                      '/'
                    )
                  ) {
                    track(nestedRef)
                  }
                }
              }
            }
          }
        )
      }
    )
  }
}
