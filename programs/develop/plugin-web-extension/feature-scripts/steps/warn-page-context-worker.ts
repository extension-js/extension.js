// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import {classifyEntrySurface} from '../../../lib/split-chunks'
import * as messages from '../messages'

// The worker URL the bundler resolved against the extension origin. The
// emitted call keeps both parts next to each other in every mode.
const WORKER_FROM_EXTENSION_URL =
  /new\s+Worker\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?new\s+URL\s*\(/

const JS_ASSET = /\.m?js$/i

export function startsWorkerFromExtensionUrl(source: string): boolean {
  return WORKER_FROM_EXTENSION_URL.test(source)
}

// A worker script must be same-origin with the document that starts it, and
// a content script's document is the page. Name it once per emitted file.
export class WarnPageContextWorker {
  apply(compiler: Compiler): void {
    if (!compiler?.hooks?.thisCompilation?.tap) return

    compiler.hooks.thisCompilation.tap(
      'scripts:warn-page-context-worker',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'scripts:warn-page-context-worker',
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
          },
          () => {
            for (const asset of compilation.getAssets()) {
              const name = String(asset.name || '')
              if (!JS_ASSET.test(name)) continue

              const surface = classifyEntrySurface(name)
              if (surface !== 'content_script' && surface !== 'script') continue

              const source = String(asset.source?.source() || '')
              if (!startsWorkerFromExtensionUrl(source)) continue

              const warning = new WebpackError(
                messages.workerStartedFromPageContext(name, surface)
              ) as Error & {file?: string}
              warning.file = name
              compilation.warnings.push(warning)
            }
          }
        )
      }
    )
  }
}
