// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {
  type EntrypointLike,
  entryOwnJsFile,
  initialJsFiles
} from '../../shared/initial-files'
import * as messages from '../messages'

export type SplitEntrySurface =
  | 'page'
  | 'background'
  | 'content_script'
  | 'script'

// Every surface loads exactly one file per entry: the HTML tag, the
// background registration, the content_scripts list or the injection call.
export function classifyEntrySurface(entryName: string): SplitEntrySurface {
  if (entryName.startsWith('background')) return 'background'
  if (entryName.startsWith('content_scripts/')) return 'content_script'
  if (entryName.startsWith('scripts/')) return 'script'
  return 'page'
}

// The bundler keeps one file per entry, so several initial files only come
// from a user cache group. The build is green while the surface loads one file
// and the entry waits for the rest forever: say so once per entry.
export class WarnSplitInitialChunks {
  apply(compiler: Compiler): void {
    if (!compiler?.hooks?.thisCompilation?.tap) return
    compiler.hooks.thisCompilation.tap(
      'scripts:warn-split-initial-chunks',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'scripts:warn-split-initial-chunks',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            const entrypoints = compilation.entrypoints as ReadonlyMap<
              string,
              EntrypointLike
            >
            for (const [entryName, entrypoint] of entrypoints) {
              const files = initialJsFiles(entrypoint)
              if (files.length <= 1) continue

              const ownFile = entryOwnJsFile(entryName, entrypoint, files)
              const extraFiles = files.filter((file) => file !== ownFile)
              if (!ownFile || extraFiles.length === 0) continue

              const warn = new WebpackError(
                messages.entrySplitAcrossInitialFiles(
                  entryName,
                  classifyEntrySurface(entryName),
                  ownFile,
                  extraFiles
                )
              ) as Error & {file?: string}
              warn.file = ownFile
              compilation.warnings.push(warn)
            }
          }
        )
      }
    )
  }
}
