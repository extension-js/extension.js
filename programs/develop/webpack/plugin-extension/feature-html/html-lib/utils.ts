import type {Compilation, Compiler} from '@rspack/core'

export type IssueType = 'error' | 'warning'

export function createIssue(
  compiler: Compiler,
  message: string,
  type: IssueType = 'error'
) {
  const ErrorCtor = compiler?.rspack?.WebpackError || Error
  const issue = new ErrorCtor(message) as Error & {name?: string}
  issue.name = type === 'warning' ? 'ExtensionWarning' : 'ExtensionError'
  return issue
}

export function reportToCompilation(
  compilation: Compilation,
  compiler: Compiler,
  message: string,
  type: IssueType = 'error',
  file?: string
) {
  const issue = createIssue(compiler, message, type) as Error & {file?: string}
  if (file) issue.file = file
  const bucket = type === 'warning' ? 'warnings' : 'errors'
  compilation[bucket] ||= []
  // de-dupe by file + message text
  const already = (compilation[bucket] as any[]).some((e: any) => {
    return (
      (e?.file || '') === (issue.file || '') &&
      String(e?.message) === String(issue.message)
    )
  })
  if (already) return
  compilation[bucket].push(issue)
}

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

    const baseHref = getBaseHref(htmlDocument)

    const getAbsolutePath = (
      htmlFilePath: string,
      filePathWithParts: string
    ) => {
      const {cleanPath} = cleanAssetUrl(filePathWithParts)
      if (cleanPath.startsWith('/')) {
        // For public paths, preserve them as-is
        return cleanPath
      }
      // If base href is present and is not a URL, resolve relative to base
      const isBaseUrl = isUrl(baseHref || '')
      const baseJoin =
        baseHref && !isBaseUrl
          ? path.join(path.dirname(htmlFilePath), baseHref)
          : path.dirname(htmlFilePath)
      return path.join(baseJoin, cleanPath)
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

export function isUrl(src: string) {
  try {
    // eslint-disable-next-line no-new
    new URL(src)
    return true
  } catch (err) {
    return false
  }
}

export function cleanAssetUrl(url: string): {
  cleanPath: string
  hash: string
  search: string
} {
  const hashIndex = url.indexOf('#')
  const queryIndex = url.indexOf('?')
  let endIndex = url.length
  if (hashIndex !== -1 && queryIndex !== -1) {
    endIndex = Math.min(hashIndex, queryIndex)
  } else if (hashIndex !== -1) {
    endIndex = hashIndex
  } else if (queryIndex !== -1) {
    endIndex = queryIndex
  }

  const cleanPath = url.slice(0, endIndex)
  const hash = hashIndex !== -1 ? url.slice(hashIndex) : ''
  const search =
    queryIndex !== -1
      ? url.slice(queryIndex, hashIndex !== -1 ? hashIndex : undefined)
      : ''
  return {cleanPath, hash, search}
}

// Shared helpers used by multiple steps
export function isHttpLike(inputUrl: string): boolean {
  return /^https?:\/\//i.test(inputUrl) || inputUrl.startsWith('//')
}

export function isSpecialScheme(u: string): boolean {
  return /^(data:|blob:|chrome-extension:|javascript:|about:)/i.test(u)
}

export function cleanLeading(s: string): string {
  return s.replace(/^\/+/, '').replace(/^\.\//, '').replace(/^\./, '')
}

export function computePosixRelative(fromPath: string, toPath: string): string {
  const rel = (path as any).relative?.(path.dirname(fromPath), toPath) || toPath
  const sep = (path as any).sep || '/'
  return rel.split(sep).join('/')
}

export function resolveAbsoluteFsPath(params: {
  asset: string
  projectRoot: string
  publicRootForResource: string
  outputRoot: string
}): {absoluteFsPath: string; isUnderPublicRoot: boolean; isRootUrl: boolean} {
  const {asset, projectRoot, publicRootForResource, outputRoot} = params
  const isRootUrl =
    asset.startsWith('/') &&
    !(
      asset.startsWith(projectRoot) ||
      asset.startsWith(publicRootForResource) ||
      asset.startsWith(outputRoot)
    )
  const isDotPublic = asset.startsWith('./public/')
  const isPlainPublic = asset.startsWith('public/')

  const absoluteFsPath = isRootUrl
    ? (() => {
        const rootRelative = asset.slice(1)
        const normalized = cleanLeading(rootRelative)
        const withoutPublicPrefix = normalized.replace(/^public\//, '')
        const candidate = path.join(publicRootForResource, withoutPublicPrefix)
        const outCandidate = path.join(outputRoot, withoutPublicPrefix)
        return fs.existsSync(candidate) ? candidate : outCandidate
      })()
    : isDotPublic
      ? path.join(projectRoot, cleanLeading(asset))
      : isPlainPublic
        ? path.join(projectRoot, asset.replace(/^\./, ''))
        : path.isAbsolute(asset)
          ? asset
          : path.join(projectRoot, asset)

  const isUnderPublicRoot = String(absoluteFsPath).startsWith(
    publicRootForResource
  )

  return {absoluteFsPath, isUnderPublicRoot, isRootUrl}
}

export function getBaseHref(htmlDocument: any): string | undefined {
  // Look for <base href="...">
  const htmlChildren = htmlDocument.childNodes || []
  for (const node of htmlChildren) {
    if (node?.nodeName !== 'html') continue
    for (const child of node.childNodes || []) {
      if (child?.nodeName !== 'head') continue
      for (const headChild of child.childNodes || []) {
        if (headChild?.nodeName === 'base') {
          const href = headChild.attrs?.find(
            (a: any) => a.name === 'href'
          )?.value
          if (href) return href
        }
      }
    }
  }
  return undefined
}
