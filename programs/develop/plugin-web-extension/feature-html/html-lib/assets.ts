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
import type {FilepathList} from '../../../types'
import {isFromFilepathList} from '../../shared/paths'
import type {HtmlStaticAttribute} from './parse-html'
import {
  applyRewrittenStaticUrl,
  getFilePath,
  getHtmlPageDeclaredAssetPath,
  joinEmittedAssetName,
  resolveStaticAttributeName
} from './utils'

export function handleStaticAsset(
  compilation: unknown,
  htmlEntry: string,
  htmlDir: string,
  absolutePath: string,
  assetType: 'staticSrc' | 'staticHref',
  cleanPath: string,
  search: string | undefined,
  hash: string | undefined,
  baseHref: string | undefined,
  includeList: FilepathList,
  extname: string,
  childNode: parse5utilities.ParsedNode,
  attributeName?: HtmlStaticAttribute
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
    const projectDir = path.dirname(path.dirname(htmlEntry))
    const publicCandidate = path.join(projectDir, 'public', cleanPath.slice(1))

    node = applyRewrittenStaticUrl(
      node,
      attrName,
      cleanPath,
      cleanPath + (search || '') + (hash || '')
    )
    return node
  }

  const baseJoin =
    baseHref && !/^\w+:\/\//.test(baseHref)
      ? path.resolve(htmlDir, baseHref)
      : htmlDir
  const fromRoot = path.parse(baseJoin).root
  const toRoot = path.parse(absolutePath).root
  const relativeFromHtml =
    fromRoot &&
    toRoot &&
    String(fromRoot).toLowerCase() !== String(toRoot).toLowerCase()
      ? path.basename(absolutePath)
      : path.relative(baseJoin, absolutePath)
  const posixRelative = relativeFromHtml.split(path.sep).join('/')
  const filepath = joinEmittedAssetName('assets', posixRelative)
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
