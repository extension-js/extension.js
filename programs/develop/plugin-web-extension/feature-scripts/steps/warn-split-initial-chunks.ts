// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {
  classifyEntrySurface,
  type EntrySurface
} from '../../../lib/split-chunks'
import {
  type EntrypointLike,
  entryOwnJsFile,
  initialJsFiles
} from '../../shared/initial-files'
import * as messages from '../messages'

export type SplitEntrySurface = EntrySurface
export {classifyEntrySurface}

// An HTML page lists every sibling chunk in its emitted markup, so only the
// single-file surfaces can be split by a user cache group: the surface loads
// one file and the entry waits for the rest forever. Say so once per entry.
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
              const surface = classifyEntrySurface(entryName)
              if (surface === 'page') continue
              const files = initialJsFiles(entrypoint)
              if (files.length <= 1) continue

              const ownFile = entryOwnJsFile(entryName, entrypoint, files)
              const extraFiles = files.filter((file) => file !== ownFile)
              if (!ownFile || extraFiles.length === 0) continue

              const warn = new WebpackError(
                messages.entrySplitAcrossInitialFiles(
                  entryName,
                  surface,
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
