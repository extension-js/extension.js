// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import type * as parse5utilities from 'parse5-utilities'
import {publicRootsFor} from '../../../plugin-special-folders/resolve-public-folder'
import type {AssetHashOptions} from '../../../plugin-static-assets/static-assets-lib/asset-output-name'
import type {FilepathList} from '../../../types'
import {isFromFilepathList} from '../../shared/paths'
import type {HtmlStaticAttribute} from './parse-html'
import {
  applyRewrittenStaticUrl,
  getFilePath,
  getHtmlPageDeclaredAssetPath,
  htmlStaticAssetOutputName,
  resolveStaticAttributeName
} from './utils'

// The public roots a compiler ships from, so a renamed or disabled public
// folder is honored rather than guessed at from the page's own location.
function resolvePublicRelativePath(
  compilation: unknown,
  absolutePath: string
): string | undefined {
  const compiler = (compilation as {compiler?: object} | undefined)?.compiler

  for (const root of publicRootsFor(compiler)) {
    const relative = path.relative(root, absolutePath)

    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/')
    }
  }

  return undefined
}

export function handleStaticAsset(
  compilation: unknown,
  htmlEntry: string,
  htmlDir: string,
  absolutePath: string,
  assetType: 'staticSrc' | 'staticHref',
  cleanPath: string,
  search: string | undefined,
  hash: string | undefined,
  includeList: FilepathList,
  extname: string,
  childNode: parse5utilities.ParsedNode,
  attributeName?: HtmlStaticAttribute,
  manifestDir?: string
): parse5utilities.ParsedNode {
  const isFilepathListEntry = isFromFilepathList(absolutePath, includeList)
  const excludedFilePath =
    path.posix.join('/', cleanPath) + (search || '') + (hash || '')
  const attrName = resolveStaticAttributeName(assetType, attributeName)

  let node = childNode

  if (isFilepathListEntry) {
    const filepath = getHtmlPageDeclaredAssetPath(
      includeList,
      absolutePath,
      extname
    )
    node = applyRewrittenStaticUrl(
      node,
      attrName,
      cleanPath,
      filepath + (search || '') + (hash || '')
    )

    return node
  }

  if (cleanPath.startsWith('/')) {
    node = applyRewrittenStaticUrl(
      node,
      attrName,
      cleanPath,
      cleanPath + (search || '') + (hash || '')
    )

    return node
  }

  // The copier flattens the public folder onto the output root and the emitter
  // skips those files, so a page ref into it names the flattened path.
  const publicRelativePath = resolvePublicRelativePath(
    compilation,
    absolutePath
  )

  if (publicRelativePath) {
    node = applyRewrittenStaticUrl(
      node,
      attrName,
      cleanPath,
      path.posix.join('/', publicRelativePath) + (search || '') + (hash || '')
    )

    return node
  }

  // The emitter and this rewrite name the asset from the same helper (a
  // <base href> plays no part here: the built page carries no base tag).
  const filepath = htmlStaticAssetOutputName(
    manifestDir,
    htmlEntry,
    absolutePath,
    (compilation as {outputOptions?: AssetHashOptions} | undefined)
      ?.outputOptions
  )

  if (fs.existsSync(absolutePath)) {
    node = applyRewrittenStaticUrl(
      node,
      attrName,
      cleanPath,
      getFilePath(filepath, '', true) + (search || '') + (hash || '')
    )
  }

  return node
}
