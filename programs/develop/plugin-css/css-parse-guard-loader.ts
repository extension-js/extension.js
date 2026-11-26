//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {WebpackError} from '@rspack/core'
import postcss from 'postcss'
import {toProjectRelativePath} from '../lib/resource-path'
import * as messages from './css-lib/messages'
import {
  registerVerbatimCss,
  verbatimCssModulePlaceholder,
  verbatimCssPlaceholder
} from './css-lib/verbatim-css'

interface CssParseGuardLoaderContext {
  resourcePath: string
  rootContext?: string
  _module?: {type?: unknown}
  _compilation?: {warnings: Error[]}
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
        const warning = new WebpackError(
          messages.cssParseErrorShippedVerbatim(
            toProjectRelativePath(this.rootContext, this.resourcePath),
            error
          )
        )
        warning.name = 'CssParseWarning'

        // Keep the diagnostic name on the compilation. The loader warning
        // wrapper can discard it when it cleans the original stack header.
        if (this._compilation) {
          this._compilation.warnings.push(warning)
        } else {
          this.emitWarning(warning)
        }

        // Short-circuit the chain. An inline asset takes the raw sheet as
        // its source, exactly as authored. The native css type would parse
        // the raw text and fail again, so it takes one placeholder rule the
        // minimizer keeps; the restore step swaps the sheet back in after.
        const moduleType = String(this._module?.type || '')

        if (moduleType.startsWith('css')) {
          const id = registerVerbatimCss(raw, this.resourcePath)
          const isCssModule =
            moduleType === 'css/module' ||
            (moduleType === 'css/auto' &&
              /\.module\.css$/i.test(this.resourcePath))

          callback(
            null,
            isCssModule
              ? verbatimCssModulePlaceholder(id, raw)
              : verbatimCssPlaceholder(id)
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
