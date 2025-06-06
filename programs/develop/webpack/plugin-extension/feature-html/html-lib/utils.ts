import * as fs from 'fs'
import * as path from 'path'
import * as parse5utilities from 'parse5-utilities'
import {parseHtml} from './parse-html'
import {type FilepathList} from '../../../webpack-types'

export interface ParsedHtmlAsset {
  css?: string[]
  js?: string[]
  static?: string[]
}

export function getAssetsFromHtml(
  htmlFilePath: string | undefined,
  htmlContent?: string,
  publicPath: string = 'public'
) {
  const assets: ParsedHtmlAsset = {
    css: [],
    js: [],
    static: []
  }

  if (!htmlFilePath) {
    return assets
  }

  try {
    const htmlString =
      htmlContent || fs.readFileSync(htmlFilePath, {encoding: 'utf8'})

    if (!htmlString) {
      return assets
    }

    const htmlDocument = parse5utilities.parse(htmlString)

    const getAbsolutePath = (htmlFilePath: string, filePath: string) => {
      if (filePath.startsWith('/')) {
        // For public paths, preserve them as-is
        return filePath
      }
      return path.join(path.dirname(htmlFilePath), filePath)
    }

    parseHtml(htmlDocument as any, ({filePath, assetType}) => {
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
  } catch (error) {
    // If file doesn't exist or can't be read, return empty assets
    return assets
  }

  return assets
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

export function getExtname(filePath: string): string {
  return path.extname(filePath)
}

export function getFilePath(
  filePath: string,
  extension: string,
  isPublic: boolean
): string {
  if (isPublic) {
    return `/${filePath}${extension}`
  }
  return `${filePath}${extension}`
}

export function isFromIncludeList(
  filePath: string,
  includeList?: FilepathList
): boolean {
  return Object.values(includeList || {}).some((value) => {
    return value === filePath
  })
}
