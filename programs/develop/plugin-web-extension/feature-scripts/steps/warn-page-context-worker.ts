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

// A worker started from a URL the call builds. The emitted call keeps both
// parts next to each other in every mode, and the base argument says which
// origin the worker resolves against.
const WORKER_FROM_URL =
  /new\s+Worker\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?new\s+URL\s*\(/

// Bases that resolve against the extension origin: the raw import.meta.url,
// the bundler's own base it rewrites that into, a runtime getURL, or a
// literal extension scheme. Anything else (location.origin, document.baseURI,
// a page URL string) resolves against the page and is the worker that runs.
const EXTENSION_BASES = [
  /^import\.meta\.url$/,
  /^[A-Za-z_$][\w$]*\.b$/,
  /^(?:chrome|browser)\.runtime\.getURL\(/,
  /^["'`](?:chrome-extension|moz-extension|safari-web-extension):\/\//
]

const JS_ASSET = /\.m?js$/i

// The arguments of the call that opens at `from`, split on top-level commas,
// or undefined when the call never closes. Strings, template literals and
// comments are skipped so a comma inside them does not split an argument.
function readCallArguments(source: string, from: number): string[] | undefined {
  const args: string[] = []
  let depth = 0
  let start = from

  for (let i = from; i < source.length; i++) {
    const char = source[i]

    if (char === '"' || char === "'" || char === '`') {
      i = skipQuoted(source, i, char)
      continue
    }

    if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 1
      continue
    }

    if (char === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i + 2)
      i = end === -1 ? source.length : end
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      depth++
      continue
    }

    if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) {
        args.push(source.slice(start, i))

        return args
      }

      depth--
      continue
    }

    if (char === ',' && depth === 0) {
      args.push(source.slice(start, i))
      start = i + 1
    }
  }

  return undefined
}

function skipQuoted(source: string, from: number, quote: string): number {
  for (let i = from + 1; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }

    if (source[i] === quote) return i
  }

  return source.length
}

function resolvesAgainstExtension(base: string | undefined): boolean {
  const text = (base ?? '').replace(/\s+/g, '')
  if (!text) return true

  return EXTENSION_BASES.some((shape) => shape.test(text))
}

export function startsWorkerFromExtensionUrl(source: string): boolean {
  const call = new RegExp(WORKER_FROM_URL.source, 'g')
  let match = call.exec(source)

  while (match) {
    const args = readCallArguments(source, match.index + match[0].length)
    if (args && resolvesAgainstExtension(args[1])) return true

    match = call.exec(source)
  }

  return false
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
