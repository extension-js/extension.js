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
import {publicContainmentRoot} from '../../../plugin-special-folders/resolve-public-folder'
import type {FilepathList, PluginInterface} from '../../../types'
import {isFolder} from '../../shared/paths'
import {
  getAssetsFromHtml,
  isHttpLike,
  isSpecialScheme,
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
            // names are exactly what a fix edits, and that save must rebuild.
            const manifestDir = path.dirname(this.manifestPath)
            const projectRoot =
              (compiler.options.context as string) || path.dirname(manifestDir)
            const publicRootForResource = publicContainmentRoot(
              this.manifestPath,
              projectRoot
            )
            const outputRoot = compilation.options?.output?.path || ''

            // A file that is not there yet is watched as missing, so creating
            // it rebuilds. A folder is never a file dependency.
            const track = (file: string) => {
              if (!file || !path.isAbsolute(file)) return

              if (!fs.existsSync(file)) {
                compilation.missingDependencies?.add(file)

                return
              }

              if (isFolder(file)) return

              if (!compilation.fileDependencies.has(file)) {
                compilation.fileDependencies.add(file)
              }
            }

            // The files a page names, resolved the way the emit step resolves
            // them, so a root URL watches the public or manifest-relative file.
            const staticFilesOf = (htmlFile: string): string[] => {
              const refs = getAssetsFromHtml(htmlFile)?.static || []

              return [...new Set(refs)]
                .filter(
                  (ref) =>
                    !isHttpLike(ref) &&
                    !isSpecialScheme(ref) &&
                    !path.basename(ref).startsWith('#')
                )
                .map(
                  (ref) =>
                    resolveAbsoluteFsPath({
                      asset: ref,
                      projectRoot,
                      publicRootForResource,
                      outputRoot,
                      manifestRoot: manifestDir
                    }).absoluteFsPath
                )
            }

            const pages = new Set(
              Object.values(this.includeList || {}).filter(
                (resource): resource is string => typeof resource === 'string'
              )
            )

            for (const page of pages) {
              track(page)

              // Parse only files that exist: getAssetsFromHtml throws on a
              // deleted HTML entry instead of reporting an empty page.
              if (!fs.existsSync(page)) continue

              for (const file of staticFilesOf(page)) {
                track(file)

                // A nested page is copied with the files it names, so those
                // are watched too. A page of the include list has its own turn.
                if (
                  /\.html?$/i.test(file) &&
                  !pages.has(file) &&
                  fs.existsSync(file) &&
                  !isFolder(file)
                ) {
                  const nested = getAssetsFromHtml(file)

                  for (const nestedFile of [
                    ...(nested?.js || []),
                    ...(nested?.css || []),
                    ...(nested?.static || [])
                  ]) {
                    if (fs.existsSync(nestedFile)) track(nestedFile)
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
