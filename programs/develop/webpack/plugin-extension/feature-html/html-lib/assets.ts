import * as fs from 'fs'
import * as path from 'path'
import * as parse5utilities from 'parse5-utilities'
import {WebpackError} from '@rspack/core'
import * as messages from './messages'
import {getFilePath, getHtmlPageDeclaredAssetPath} from './utils'
import {type FilepathList} from '../../../webpack-types'
import * as utils from '../../../../develop-lib/utils'

export function handleStaticAsset(
  compilation: any,
  htmlEntry: string,
  htmlDir: string,
  absolutePath: string,
  assetType: 'staticSrc' | 'staticHref',
  cleanPath: string,
  search: string | undefined,
  hash: string | undefined,
  baseHref: string | undefined,
  includeList: FilepathList,
  excludeList: FilepathList,
  extname: string,
  childNode: any
) {
  const isExcludedPath = utils.shouldExclude(
    path.resolve(htmlDir, cleanPath),
    excludeList
  )
  const isFilepathListEntry = utils.isFromFilepathList(
    absolutePath,
    includeList
  )
  const excludedFilePath =
    path.posix.join('/', cleanPath) + (search || '') + (hash || '')

  let node = childNode
  if (isExcludedPath) {
    node = parse5utilities.setAttribute(
      node,
      assetType === 'staticSrc' ? 'src' : 'href',
      excludedFilePath
    )
    return node
  }

  if (isFilepathListEntry) {
    const filepath = getHtmlPageDeclaredAssetPath(
      includeList,
      absolutePath,
      extname
    )
    node = parse5utilities.setAttribute(
      node,
      assetType === 'staticSrc' ? 'src' : 'href',
      filepath + (search || '') + (hash || '')
    )
    return node
  }

  if (cleanPath.startsWith('/')) {
    const publicCandidate = path.posix.join('public', cleanPath.slice(1))

    if (!fs.existsSync(publicCandidate)) {
      const warn = new WebpackError(
        messages.htmlFileNotFoundMessageOnly('static')
      )
      warn.name = 'HtmlStaticAssetMissing'
      // @ts-expect-error - file is not a property of WebpackError
      warn.file = htmlEntry
      compilation.warnings.push(warn)
    }
    node = parse5utilities.setAttribute(
      node,
      assetType === 'staticSrc' ? 'src' : 'href',
      cleanPath + (search || '') + (hash || '')
    )
    return node
  }

  const baseJoin =
    baseHref && !/^\w+:\/\//.test(baseHref)
      ? path.resolve(htmlDir, baseHref)
      : htmlDir
  const relativeFromHtml = path.relative(baseJoin, absolutePath)
  const posixRelative = relativeFromHtml.split(path.sep).join('/')
  const filepath = path.posix.join('assets', posixRelative)
  if (fs.existsSync(absolutePath)) {
    node = parse5utilities.setAttribute(
      node,
      assetType === 'staticSrc' ? 'src' : 'href',
      getFilePath(filepath, '', true) + (search || '') + (hash || '')
    )
  }
  return node
}
