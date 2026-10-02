//      ██╗███████╗      ███████╗██████╗  █████╗ ███╗   ███╗███████╗██╗    ██╗ ██████╗ ██████╗ ██╗  ██╗███████╗
//      ██║██╔════╝      ██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝██║    ██║██╔═══██╗██╔══██╗██║ ██╔╝██╔════╝
//      ██║███████╗█████╗█████╗  ██████╔╝███████║██╔████╔██║█████╗  ██║ █╗ ██║██║   ██║██████╔╝█████╔╝ ███████╗
// ██   ██║╚════██║╚════╝██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ██║███╗██║██║   ██║██╔══██╗██╔═██╗ ╚════██║
// ╚█████╔╝███████║      ██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗╚███╔███╔╝╚██████╔╝██║  ██║██║  ██╗███████║
//  ╚════╝ ╚══════╝      ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝ ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createRequire} from 'node:module'
import * as acorn from 'acorn'

const requireModule = createRequire(import.meta.url)

type LoaderFunction = (
  this: SolidJsxGateLoaderContext,
  source: string,
  map?: unknown
) => void

interface SolidJsxGateLoaderContext {
  getOptions(): {babelLoader: string}
  callback(error: Error | null, source?: string, map?: unknown): void
}

function parsesAsPlainJavaScript(source: string): boolean {
  for (const sourceType of ['module', 'script'] as const) {
    try {
      acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowHashBang: true
      })

      return true
    } catch {
      // Try the next source type
    }
  }

  return false
}

// Every JSX element closes with "/>" or "</". A string or a comment can hold
// those too, but then the file parses as plain JavaScript, which JSX never does.
export function mayContainJsx(source: string): boolean {
  if (!/<\s*\/|\/\s*>/.test(source)) return false

  return !parsesAsPlainJavaScript(source)
}

const babelLoaders = new Map<string, LoaderFunction>()

// babel-loader passes every option it does not know on to Babel, which
// refuses an unknown one, so the path to the loader itself is taken out.
function babelLoaderAt(babelLoader: string): LoaderFunction {
  let loader = babelLoaders.get(babelLoader)

  if (!loader) {
    loader = requireModule(babelLoader).custom(() => ({
      customOptions: async ({
        babelLoader: _own,
        ...options
      }: Record<string, unknown>) => ({custom: null, loader: options})
    })) as LoaderFunction

    babelLoaders.set(babelLoader, loader)
  }

  return loader
}

// Babel on every plain script made a Solid build several times slower, so a
// file with no JSX skips it and goes on to the next loader as it came in.
export default function solidJsxGateLoader(
  this: SolidJsxGateLoaderContext,
  source: string,
  map?: unknown
): void {
  if (!mayContainJsx(String(source))) {
    this.callback(null, source, map)

    return
  }

  babelLoaderAt(this.getOptions().babelLoader).call(this, source, map)
}
