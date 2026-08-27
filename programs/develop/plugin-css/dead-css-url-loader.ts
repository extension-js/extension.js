//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// A content-script stylesheet is inlined as asset/inline, so rspack never parses
// it and never resolves its url() children. The module-graph check in
// plugin-css/index.ts can therefore never see them, and a dead reference there
// was silent while the same string in a linked stylesheet warned. Scan the text.

import * as path from 'node:path'
import {WebpackError} from '@rspack/core'
import {extractCssUrlRefs, isDeadCssUrlRef} from './css-lib/dead-url-refs'
import * as messages from './css-lib/messages'

interface CompilationLike {
  warnings?: Error[]
  errors?: Error[]
}

interface DeadCssUrlLoaderContext {
  resourcePath: string
  getOptions(): {manifestPath?: string; projectPath?: string}
  emitWarning(warning: Error): void
  emitError(error: Error): void
  _compilation?: CompilationLike
}

export default function deadCssUrlLoader(
  this: DeadCssUrlLoaderContext,
  source: string
): string {
  try {
    const {manifestPath, projectPath} = this.getOptions() || {}
    if (!manifestPath || !projectPath) return source

    const manifestDir = path.dirname(manifestPath)
    const roots = [path.join(projectPath, 'public'), manifestDir]
    const issuerDir = path.dirname(this.resourcePath)
    const issuerPath =
      path.relative(manifestDir, this.resourcePath) || this.resourcePath

    const strict = process.env.EXTENSION_STRICT_REFS === 'true'
    const compilation = this._compilation

    for (const request of extractCssUrlRefs(source)) {
      if (!isDeadCssUrlRef(request, {issuerDir, roots})) continue

      const report = new WebpackError(
        messages.deadCssUrlRef(issuerPath, request)
      )
      ;(report as Error & {file?: string}).file = issuerPath

      // Straight onto the compilation, the way the module-graph check reports
      // it. emitWarning would stamp a "Module Warning (from <loader>)" prefix
      // and the two paths would read as different defects.
      const sink = strict ? compilation?.errors : compilation?.warnings
      if (sink) {
        sink.push(report)
      } else if (strict) {
        this.emitError(report)
      } else {
        this.emitWarning(report)
      }
    }
  } catch {
    // A reference check must never break a build the browser would accept.
  }

  return source
}
