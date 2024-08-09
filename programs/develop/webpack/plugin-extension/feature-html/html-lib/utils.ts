import fs from 'fs'
import path from 'path'
// @ts-ignore
import parse5utils from 'parse5-utils'
import {parseHtml} from './parse-html'
import {type FilepathList} from '../../../webpack-types'

export interface ParsedHtmlAsset {
  css?: string[]
  js?: string[]
  static?: string[]
}

export function getAssetsFromHtml(
  htmlFilePath: string | undefined,
  htmlContent?: string
) {
  const assets: ParsedHtmlAsset = {
    css: [],
    js: [],
    static: []
  }

  if (!htmlFilePath) {
    return assets
  }

  const htmlString =
    htmlContent || fs.readFileSync(htmlFilePath, {encoding: 'utf8'})
  const htmlDocument = parse5utils.parse(htmlString)

  const getAbsolutePath = (htmlFilePath: string, filePath: string) => {
    return path.join(
      path.dirname(htmlFilePath),
      filePath.startsWith('/')
        ? path.relative(path.dirname(htmlFilePath), filePath)
        : filePath
    )
  }

  for (const node of htmlDocument.childNodes) {
    if (node.nodeName !== 'html') continue

    for (const childNode of node.childNodes) {
      // We don't really care whether the asset is in the head or body
      // element, as long as it's not a regular text note, we're good.
      if (childNode.nodeName === 'head' || childNode.nodeName === 'body') {
        parseHtml(childNode, ({filePath, assetType}) => {
          const fileAbsolutePath = getAbsolutePath(htmlFilePath, filePath)

          switch (assetType) {
            case 'script':
              assets.js?.push(fileAbsolutePath)
              break
            case 'css':
              assets.css?.push(fileAbsolutePath)
              break
            case 'staticSrc':
            case 'staticHref':
              if (filePath.startsWith('#')) {
                break
              }
              assets.static?.push(fileAbsolutePath)
              break
            default:
              break
          }
        })
      }
    }

    return {
      // Assets from HTML pages to copy to the outputFilePath path
      css: assets.css,
      // Assets frorm HTML pages to use as webpack entries
      js: assets.js,
      // Assets frorm HTML pages to copy to the outputFilePath path
      static: assets.static
    }
  }
}

export function getHtmlPageDeclaredAssetPath(
  filepathList: FilepathList,
  filePath: string,
  extension: string
): string {
  const entryname =
    Object.keys(filepathList).find((key) => {
      const includePath = filepathList[key] as string
      return (
        filepathList[key] === filePath ||
        getAssetsFromHtml(includePath)?.js?.includes(filePath) ||
        getAssetsFromHtml(includePath)?.css?.includes(filePath)
      )
    }) || ''

  const extname = getExtname(filePath)
  if (!entryname) return `${filePath.replace(extname, '')}${extension}`

  return `/${entryname.replace(extname, '')}${extension}`
}

export function getExtname(filePath: string) {
  const extname = path.extname(filePath)

  switch (extname) {
    case '.js':
    case '.mjs':
    case '.ts':
    case '.tsx':
      return '.js'
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return '.css'
    case '.html':
      return '.html'
    default:
      return '.js'
  }
}

export function getFilePath(
  outputname: string,
  extension: string,
  isAbsolute?: boolean
) {
  return isAbsolute ? `/${outputname}${extension}` : `${outputname}${extension}`
}

export function isFromIncludeList(
  filePath: string,
  includeList?: FilepathList
): boolean {
  return Object.values(includeList || {}).some((value) => {
    return value === filePath
  })
}
