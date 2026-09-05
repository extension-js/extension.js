//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// The last loader a content-script stylesheet passes through. rspack never
// parses an inlined sheet, so url() children never reach the module graph:
// the dead-reference check in plugin-css/index.ts cannot see them (scan the
// text), and their targets are never emitted. Live references are rewritten
// to the extension root and emitted here. An inlined sheet then leaves as a
// JavaScript module that builds its data: URL at runtime (see
// inline-content-script-css). A CSS module keeps rspack's native scoping and
// class-name exports, so it leaves as CSS with the placeholder still in the
// text, and the content-script wrapper swaps it in when it injects the chunk.

import * as fs from 'node:fs'
import * as path from 'node:path'
import {WebpackError} from '@rspack/core'
import {canonicalizeDir} from '../lib/resource-path'
import {publicFolderOrDefault} from '../plugin-special-folders/resolve-public-folder'
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

export interface DeadCssUrlLoaderOptions {
  manifestPath?: string
  projectPath?: string
  // 'inline' (default): the sheet leaves as the runtime stylesheet module.
  // 'chunk': the sheet stays CSS for rspack's native css/module pipeline.
  sheet?: 'inline' | 'chunk'
}

interface DeadCssUrlLoaderContext {
  resourcePath: string
  getOptions(): DeadCssUrlLoaderOptions
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
  publicRoot: string
) {
  const roots = [publicRoot, manifestDir]
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
  publicRoot: string,
  sheet: DeadCssUrlLoaderOptions['sheet']
): string {
  const {css, targets} = rewriteInlinedCssUrls(source, {
    resourcePath: loader.resourcePath,
    manifestDir,
    publicRoot
  })
  if (typeof loader.emitFile !== 'function') return source

  for (const target of targets) {
    // The public copier ships a public-owned file under this same name, and
    // the inlined sheet's module names it for web_accessible_resources. A
    // CSS module's chunk text is never scanned for that list, so the file is
    // registered to the module too: same name, same bytes, still one file.
    if (!target.publicOwned || sheet === 'chunk') {
      loader.emitFile(target.outputName, fs.readFileSync(target.absolutePath))
    }
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
  const options = this.getOptions() || {}
  try {
    const {manifestPath, projectPath} = options
    if (manifestPath && projectPath) {
      // rspack hands the loader a symlink-resolved resource path. The roots
      // it is measured against must be resolved the same way, or a project
      // under a symlinked dir names its targets by a path that climbs out.
      const manifestDir = canonicalizeDir(path.dirname(manifestPath))
      const publicRoot = canonicalizeDir(
        publicFolderOrDefault(manifestPath, projectPath)
      )
      reportDeadRefs(this, source, manifestDir, publicRoot)
      css = emitTargets(this, source, manifestDir, publicRoot, options.sheet)
    }
  } catch {
    // A reference check must never break a build the browser would accept.
  }

  if (options.sheet === 'chunk') return css
  return toRuntimeStylesheetModule(css)
}
