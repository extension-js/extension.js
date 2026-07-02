//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

// CSS parse guard (G17).
//
// Browsers are spec-required to error-recover invalid CSS: a garbage rule is
// dropped and the rest of the stylesheet applies. PostCSS is not — a single
// malformed declaration (commonly tool-generated, e.g. Tailwind scanning a JS
// template literal into an arbitrary-property class) throws a CssSyntaxError
// and aborts the whole build on a file Chrome would load fine.
//
// This loader pitches ahead of postcss-loader on plain .css stylesheets: if
// the file parses, the chain continues untouched; if it doesn't, the build
// gets a warning and the stylesheet ships verbatim — matching what the
// browser would do with it.

import * as fs from 'fs'
import postcss from 'postcss'
import * as messages from './css-lib/messages'

interface CssParseGuardLoaderContext {
  resourcePath: string
  async(): (err: Error | null, content?: string) => void
  emitWarning(warning: Error): void
}

export default function cssParseGuardLoader(
  this: unknown,
  source: string
): string {
  return source
}

export function pitch(this: CssParseGuardLoaderContext): void {
  const callback = this.async()

  // Only guard plain stylesheets. Preprocessor sources (.scss/.less) are a
  // compile step, not something a browser would ever load — their errors
  // must stay fatal.
  if (!this.resourcePath || !this.resourcePath.endsWith('.css')) {
    callback(null)
    return
  }

  fs.promises
    .readFile(this.resourcePath, 'utf8')
    .then((raw) => {
      try {
        postcss.parse(raw, {from: this.resourcePath})
        // Valid CSS: fall through to postcss-loader and the rest of the chain.
        callback(null)
      } catch (error) {
        this.emitWarning(
          new Error(messages.cssParseErrorShippedVerbatim(this.resourcePath, error))
        )
        // Short-circuit the chain: the raw stylesheet becomes the module
        // source, exactly as authored.
        callback(null, raw)
      }
    })
    .catch(() => {
      // Unreadable resource: let the real loader chain surface the error.
      callback(null)
    })
}
