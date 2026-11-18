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
  cssUrlRefFiles,
  extractCssUrlRefs,
  isDeadCssUrlRef,
  toPosixPath
} from './css-lib/dead-url-refs'
import {
  rewriteInlinedCssUrls,
  toRuntimeStylesheetModule
} from './css-lib/inline-content-script-css'
import {inlineCssImports, readCssImports} from './css-lib/inline-css-imports'
import * as messages from './css-lib/messages'
import {isSfcStyleBlock} from './css-lib/sfc-style-block'

interface CompilationLike {
  warnings?: Error[]
  errors?: Error[]
}

export interface DeadCssUrlLoaderOptions {
  manifestPath?: string
  projectPath?: string
  gecko?: boolean
  baseAttribute?: string
  baseScheme?: string
  // The first of this loader's two runs on a sheet: ahead of PostCSS, it
  // brings in the rules of each sheet an @import names and stays CSS.
  inlineImports?: boolean
}

export interface DeadCssUrlLoaderContext {
  resourcePath: string
  resourceQuery?: string
  getOptions(): DeadCssUrlLoaderOptions
  emitWarning(warning: Error): void
  emitError(error: Error): void
  addDependency?(file: string): void
  addMissingDependency?(file: string): void
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

    // Keep watch mode honest: writing the file later should rebuild the sheet.
    for (const candidate of cssUrlRefFiles(request, {issuerDir, roots})) {
      loader.addMissingDependency?.(candidate)
    }

    const report = new WebpackError(
      messages.deadCssUrlRef(issuerPath, request, strict)
    )
    ;(report as Error & {file?: string}).file = issuerPath
    report.name = 'CssDeadRef'

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

// The files an import that stays names and the run ahead of PostCSS gave a
// reason for, by sheet, so the run after it does not say so a second time.
const answeredImports = new Map<string, Set<string>>()

function importsKey(loader: DeadCssUrlLoaderContext): string {
  return `${canonicalizeResourcePath(loader.resourcePath)}${loader.resourceQuery || ''}`
}

// Only once every tool ran is it known that no plugin brought an import in.
// An address with a scheme is the browser's to fetch, and stays.
function reportLeftImports(
  loader: DeadCssUrlLoaderContext,
  source: string,
  manifestDir: string,
  publicRoot: string
) {
  const resourcePath = canonicalizeResourcePath(loader.resourcePath)
  const context = {
    issuerDir: path.dirname(resourcePath),
    roots: [publicRoot, manifestDir]
  }
  const answered = answeredImports.get(importsKey(loader))
  const told = new Set<string>()

  for (const {statement, request, viaUrl} of readCssImports(source)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(request)) continue
    if (request.includes('!') || told.has(statement)) continue
    // The dead reference check already names a path that leads nowhere.
    if (isDeadCssUrlRef(request, context)) continue

    const asPath =
      viaUrl && /^[^./~@#]/.test(request) ? `./${request}` : request

    if (cssUrlRefFiles(asPath, context).some((file) => answered?.has(file))) {
      continue
    }

    told.add(statement)
    loader.emitWarning(
      Object.assign(
        new Error(
          messages.cssImportStillInSheet(
            toPosixPath(path.relative(manifestDir, resourcePath)),
            statement
          )
        ),
        {name: 'CssParseWarning'}
      )
    )
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

// Reports the sheet's dead url() targets and names the live ones the way
// the runtime stylesheet module reads them back.
export function inlineStylesheetUrls(
  loader: DeadCssUrlLoaderContext,
  source: string
): {css: string; bundledRequests: string[]} {
  let css = source
  let bundledRequests: string[] = []
  const options = loader.getOptions() || {}

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
      reportDeadRefs(loader, source, manifestDir, publicRoot)
      reportLeftImports(loader, source, manifestDir, publicRoot)
      ;({css, bundledRequests} = resolveTargets(
        loader,
        source,
        manifestDir,
        publicRoot,
        resolvePublicFolder(manifestPath, projectPath)
      ))
    }
  } catch (error) {
    // A reference check must never break a build the browser would accept.
    loader.emitWarning(
      Object.assign(
        new Error(messages.cssUrlRewriteSkipped(loader.resourcePath, error)),
        {name: 'CssUrlRewriteWarning'}
      )
    )
  }

  return {css, bundledRequests}
}

// The sheet with the rules of every project sheet it imports. A data: URL
// gives a relative @import no base, so the browser would never fetch one.
export function inlineStylesheetImports(
  loader: DeadCssUrlLoaderContext,
  source: string
): string {
  const {manifestPath, projectPath} = loader.getOptions() || {}

  if (!manifestPath || !projectPath) return source

  try {
    const manifestDir = canonicalizeDir(path.dirname(manifestPath))
    const publicRoot = canonicalizeDir(
      publicContainmentRoot(manifestPath, projectPath)
    )
    const resourcePath = canonicalizeResourcePath(loader.resourcePath)
    const inlined = inlineCssImports(source, {
      resourcePath,
      roots: [publicRoot, manifestDir],
      projectPath
    })

    // Keep watch mode honest: an edit to an imported sheet rebuilds this
    // one, and so does writing a sheet that was not there.
    for (const file of inlined.files) loader.addDependency?.(file)
    for (const file of inlined.missing) loader.addMissingDependency?.(file)

    for (const {request, file, reason, fix} of inlined.unreadable) {
      loader.addDependency?.(file)
      loader.emitWarning(
        Object.assign(
          new Error(
            messages.cssImportLeftAsWritten(
              toPosixPath(path.relative(manifestDir, resourcePath)),
              request,
              reason,
              fix
            )
          ),
          {name: 'CssParseWarning'}
        )
      )
    }

    const issuer = toPosixPath(path.relative(manifestDir, resourcePath))
    const placed = [
      ...inlined.moved.map(({statement, file}) =>
        messages.cssImportMovedAhead(
          issuer,
          statement,
          toPosixPath(path.relative(manifestDir, file))
        )
      ),
      ...inlined.skipped.map(({statement, file, why}) =>
        messages.cssImportSkippedInBlock(
          issuer,
          statement,
          toPosixPath(path.relative(manifestDir, file)),
          why
        )
      ),
      ...inlined.cycles.map((files) =>
        messages.cssImportCycle(
          issuer,
          files.map((file) => toPosixPath(path.relative(manifestDir, file)))
        )
      )
    ]

    for (const message of new Set(placed)) {
      loader.emitWarning(
        Object.assign(new Error(message), {name: 'CssParseWarning'})
      )
    }

    answeredImports.set(importsKey(loader), new Set(inlined.answered))

    return inlined.css
  } catch (error) {
    loader.emitWarning(
      Object.assign(
        new Error(messages.cssUrlRewriteSkipped(loader.resourcePath, error)),
        {name: 'CssUrlRewriteWarning'}
      )
    )

    return source
  }
}

export default function deadCssUrlLoader(
  this: DeadCssUrlLoaderContext,
  source: string
): string {
  const options = this.getOptions() || {}

  if (options.inlineImports) return inlineStylesheetImports(this, source)

  // A component's style block is still CSS for the loaders after this one.
  // Its own loader turns it into a module once the framework is done with it.
  if (isSfcStyleBlock(this)) return source

  const {css, bundledRequests} = inlineStylesheetUrls(this, source)

  return toRuntimeStylesheetModule(
    css,
    bundledRequests,
    undefined,
    options.gecko === true,
    options.baseAttribute,
    options.baseScheme
  )
}
