//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Browsers error-recover invalid CSS but PostCSS aborts the build; pitch ahead
// of postcss-loader so an unparseable .css ships verbatim with a warning.

import * as fs from 'node:fs'
import postcss from 'postcss'
import * as messages from './css-lib/messages'
import {
  registerVerbatimCss,
  verbatimCssPlaceholder
} from './css-lib/verbatim-css'

interface CssParseGuardLoaderContext {
  resourcePath: string
  _module?: {type?: unknown}
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
  // compile step, not something a browser loads, so their errors stay fatal.
  if (!this.resourcePath || !this.resourcePath.endsWith('.css')) {
    callback(null)
    return
  }

  fs.promises
    .readFile(this.resourcePath, 'utf8')
    .then((raw) => {
      try {
        postcss.parse(raw, {from: this.resourcePath})
        callback(null)
      } catch (error) {
        this.emitWarning(
          new Error(
            messages.cssParseErrorShippedVerbatim(this.resourcePath, error)
          )
        )
        // Short-circuit the chain. An inline asset takes the raw sheet as
        // its source, exactly as authored. The native css type would parse
        // the raw text and fail again, so it takes one placeholder rule the
        // minimizer keeps; the restore step swaps the sheet back in after.
        const moduleType = String(this._module?.type || '')
        if (moduleType.startsWith('css')) {
          callback(
            null,
            verbatimCssPlaceholder(registerVerbatimCss(raw, this.resourcePath))
          )
          return
        }
        callback(null, raw)
      }
    })
    .catch(() => {
      // Unreadable resource: let the real loader chain surface the error.
      callback(null)
    })
}
