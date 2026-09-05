//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// The last loader an inlined content-script stylesheet passes through. rspack
// never parses the sheet, so url() children never reach the module graph: the
// dead-reference check in plugin-css/index.ts cannot see them (scan the text),
// and their targets are never emitted. Live references are rewritten to the
// extension root and emitted here, and the sheet leaves as a JavaScript
// module that builds its data: URL at runtime (see inline-content-script-css).

import * as fs from 'node:fs'
import * as path from 'node:path'
import {WebpackError} from '@rspack/core'
import {
  extractCssUrlRefs,
  isDeadCssUrlRef,
  toPosixPath
} from './css-lib/dead-url-refs'
import {
  rewriteInlinedCssUrls,
  toRuntimeStylesheetModule
} from './css-lib/inline-content-script-css'
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
  emitFile?(name: string, content: string | Buffer): void
  addDependency?(file: string): void
  _compilation?: CompilationLike
}

function reportDeadRefs(
  loader: DeadCssUrlLoaderContext,
  source: string,
  manifestDir: string,
  projectPath: string
) {
  const roots = [path.join(projectPath, 'public'), manifestDir]
  const issuerDir = path.dirname(loader.resourcePath)
  const issuerPath = toPosixPath(
    path.relative(manifestDir, loader.resourcePath) || loader.resourcePath
  )

  const strict = process.env.EXTENSION_STRICT_REFS === 'true'
  const compilation = loader._compilation

  for (const request of extractCssUrlRefs(source)) {
    if (!isDeadCssUrlRef(request, {issuerDir, roots})) continue

    const report = new WebpackError(messages.deadCssUrlRef(issuerPath, request))
    ;(report as Error & {file?: string}).file = issuerPath

    // Straight onto the compilation, the way the module-graph check reports
    // it. emitWarning would stamp a "Module Warning (from <loader>)" prefix
    // and the two paths would read as different defects.
    const sink = strict ? compilation?.errors : compilation?.warnings
    if (sink) {
      sink.push(report)
    } else if (strict) {
      loader.emitError(report)
    } else {
      loader.emitWarning(report)
    }
  }
}

function emitTargets(
  loader: DeadCssUrlLoaderContext,
  source: string,
  manifestDir: string,
  projectPath: string
): string {
  const {css, targets} = rewriteInlinedCssUrls(source, {
    resourcePath: loader.resourcePath,
    manifestDir,
    publicRoot: path.join(projectPath, 'public')
  })
  if (typeof loader.emitFile !== 'function') return source

  for (const target of targets) {
    loader.emitFile(target.outputName, fs.readFileSync(target.absolutePath))
    // Keep watch mode honest: editing the file should rebuild the sheet.
    loader.addDependency?.(target.absolutePath)
  }
  return css
}

export default function deadCssUrlLoader(
  this: DeadCssUrlLoaderContext,
  source: string
): string {
  let css = source
  try {
    const {manifestPath, projectPath} = this.getOptions() || {}
    if (manifestPath && projectPath) {
      const manifestDir = path.dirname(manifestPath)
      reportDeadRefs(this, source, manifestDir, projectPath)
      css = emitTargets(this, source, manifestDir, projectPath)
    }
  } catch {
    // A reference check must never break a build the browser would accept.
  }

  return toRuntimeStylesheetModule(css)
}
