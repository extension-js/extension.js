//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {canonicalizeDir, canonicalizeResourcePath} from '../lib/resource-path'
import {toPosixPath} from './css-lib/dead-url-refs'
import {toRuntimeStylesheetModule} from './css-lib/inline-content-script-css'
import {
  dropSourceMapComment,
  isSfcInlineStyleBlockQuery,
  isSfcModuleStyleBlockQuery,
  isSfcStyleBlock,
  moduleStyleBlockRequest,
  readStyleBlockProxyRequest,
  sfcStyleBlockId
} from './css-lib/sfc-style-block'
import {
  type DeadCssUrlLoaderContext,
  inlineStylesheetUrls
} from './dead-css-url-loader'

interface SfcStyleBlockLoaderContext extends DeadCssUrlLoaderContext {
  mode?: string
  loaderIndex?: number
  loaders?: Array<{path?: string; request?: string}>
  context?: string
  utils?: {contextify?(context: string, request: string): string}
  async(): (error: Error | null, content?: string) => void
  importModule(
    request: string,
    options: Record<string, unknown>,
    callback: (error: Error | null | undefined, exports: unknown) => void
  ): void
}

// The framework lists every loader of the block's rule again in the request
// that compiles it. Only the copy that runs last sees the finished sheet.
function runsLast(loader: SfcStyleBlockLoaderContext): boolean {
  const {loaders, loaderIndex} = loader
  if (!Array.isArray(loaders) || typeof loaderIndex !== 'number') return true

  const own = loaders[loaderIndex]?.path

  return loaders.findIndex((entry) => entry?.path === own) === loaderIndex
}

// A content script's stylesheet is a JavaScript module, and a component's
// style block reaches that rule as CSS text nothing would ever apply.
export default function sfcStyleBlockLoader(
  this: SfcStyleBlockLoaderContext,
  source: string
): string | undefined {
  if (!isSfcStyleBlock(this) || !runsLast(this)) {
    return source
  }

  const inline = isSfcInlineStyleBlockQuery(this.resourceQuery)
  const proxied = readStyleBlockProxyRequest(source)

  // An inline block is typed as text, so the proxy cannot import anything.
  // The request it names is built here and its text takes the proxy's place.
  if (proxied && inline) {
    const done = this.async()

    this.importModule(proxied, {}, (error, exports) => {
      if (error) return done(error)

      const text =
        typeof exports === 'string'
          ? exports
          : (exports as {default?: unknown} | undefined)?.default

      done(null, typeof text === 'string' ? text : '')
    })

    return
  }

  if (proxied) return `import ${JSON.stringify(proxied)};\n`

  // The component reads an inline block as text and places it itself.
  if (inline) return source

  const {css, bundledRequests} = inlineStylesheetUrls(
    this,
    this.mode === 'production' ? dropSourceMapComment(source) : source
  )
  const {projectPath, gecko} = this.getOptions() || {}
  const resourcePath = canonicalizeResourcePath(this.resourcePath)
  const relativePath = projectPath
    ? toPosixPath(path.relative(canonicalizeDir(projectPath), resourcePath))
    : path.basename(resourcePath)

  return toRuntimeStylesheetModule(
    css,
    bundledRequests,
    sfcStyleBlockId(
      relativePath,
      String(this.resourceQuery || ''),
      this.mode === 'development' && projectPath ? projectPath : ''
    ),
    gecko === true
  )
}

// Pitching from a post rule runs ahead of vue-loader's own pitcher, the one
// that refuses the block, and what it returns stands in for the whole chain.
export function pitch(this: SfcStyleBlockLoaderContext): string | undefined {
  const query = String(this.resourceQuery || '')
  if (!isSfcModuleStyleBlockQuery(query)) return undefined

  const loaders = this.loaders || []
  const absolute = moduleStyleBlockRequest({
    resourcePath: this.resourcePath,
    resourceQuery: query,
    loaders,
    ownPath: loaders[this.loaderIndex ?? 0]?.path
  })
  if (!absolute) return undefined

  // Relative to the importer, so the same sources build the same bytes
  // wherever the project folder lives.
  const request = JSON.stringify(
    this.context && this.utils?.contextify
      ? this.utils.contextify(this.context, absolute)
      : absolute
  )

  return `export {default} from ${request};\nexport * from ${request};\n`
}
