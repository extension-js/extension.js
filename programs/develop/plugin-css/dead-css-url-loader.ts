//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {WebpackError} from '@rspack/core'
import {canonicalizeDir, canonicalizeResourcePath} from '../lib/resource-path'
import {
  publicContainmentRoot,
  resolvePublicFolder
} from '../plugin-special-folders/resolve-public-folder'
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
}

interface DeadCssUrlLoaderContext {
  resourcePath: string
  getOptions(): DeadCssUrlLoaderOptions
  emitWarning(warning: Error): void
  emitError(error: Error): void
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
  // Both sides of every path comparison go through the same canonical form:
  // on Windows rspack can hand over an 8.3 short path while the roots above
  // were expanded, and a mismatch names the target by a path that climbs out.
  const resourcePath = canonicalizeResourcePath(loader.resourcePath)
  const issuerDir = path.dirname(resourcePath)
  const issuerPath = toPosixPath(
    path.relative(manifestDir, resourcePath) || resourcePath
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

function resolveTargets(
  loader: DeadCssUrlLoaderContext,
  source: string,
  manifestDir: string,
  publicRoot: string,
  publicDir: string | undefined
): {css: string; bundledRequests: string[]} {
  const resourcePath = canonicalizeResourcePath(loader.resourcePath)
  const {css, targets} = rewriteInlinedCssUrls(source, {
    resourcePath,
    manifestDir,
    publicRoot,
    publicDir
  })
  const bundledRequests: string[] = []

  for (const target of targets) {
    // The public copier ships a public-owned file. Any other file is asked
    // of the bundler, so every sheet that names it shares the one emitted copy.
    if (!target.publicOwned) {
      const request = toPosixPath(
        path.relative(path.dirname(resourcePath), target.absolutePath)
      )

      bundledRequests.push(
        request.startsWith('../') || path.isAbsolute(request)
          ? request
          : `./${request}`
      )
    }

    // Keep watch mode honest: editing the file should rebuild the sheet.
    loader.addDependency?.(target.absolutePath)
  }

  return {css, bundledRequests}
}

export default function deadCssUrlLoader(
  this: DeadCssUrlLoaderContext,
  source: string
): string {
  let css = source
  let bundledRequests: string[] = []
  const options = this.getOptions() || {}

  try {
    const {manifestPath, projectPath} = options

    if (manifestPath && projectPath) {
      // rspack hands the loader a symlink-resolved resource path. The roots
      // it is measured against must be resolved the same way, or a project
      // under a symlinked dir names its targets by a path that climbs out.
      const manifestDir = canonicalizeDir(path.dirname(manifestPath))
      const publicRoot = canonicalizeDir(
        publicContainmentRoot(manifestPath, projectPath)
      )
      reportDeadRefs(this, source, manifestDir, publicRoot)
      ;({css, bundledRequests} = resolveTargets(
        this,
        source,
        manifestDir,
        publicRoot,
        resolvePublicFolder(manifestPath, projectPath)
      ))
    }
  } catch {
    // A reference check must never break a build the browser would accept.
  }

  return toRuntimeStylesheetModule(css, bundledRequests)
}
