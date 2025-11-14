import * as fs from 'fs'
import * as path from 'path'
import * as parse5utilities from 'parse5-utilities'
import {getFilePath, getHtmlPageDeclaredAssetPath} from './utils'
import {isFromFilepathList} from '../html-lib/paths'
import {type FilepathList} from '../../../webpack-types'

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
  extname: string,
  childNode: any
) {
  const isFilepathListEntry = isFromFilepathList(absolutePath, includeList)
  const excludedFilePath =
    path.posix.join('/', cleanPath) + (search || '') + (hash || '')

  let node = childNode

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
    const projectDir = path.dirname(path.dirname(htmlEntry))
    const publicCandidate = path.join(projectDir, 'public', cleanPath.slice(1))

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
  const fromRoot = path.parse(baseJoin).root
  const toRoot = path.parse(absolutePath).root
  const relativeFromHtml =
    fromRoot &&
    toRoot &&
    String(fromRoot).toLowerCase() !== String(toRoot).toLowerCase()
      ? path.basename(absolutePath)
      : path.relative(baseJoin, absolutePath)
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
