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
  isSfcStyleBlockQuery,
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
  loaders?: Array<{path?: string}>
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
): string {
  if (!isSfcStyleBlockQuery(this.resourceQuery) || !runsLast(this)) {
    return source
  }

  const proxied = readStyleBlockProxyRequest(source)
  if (proxied) return `import ${JSON.stringify(proxied)};\n`

  const {css, bundledRequests} = inlineStylesheetUrls(this, source)
  const {projectPath} = this.getOptions() || {}
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
    )
  )
}
