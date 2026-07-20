// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as parse5utilities from 'parse5-utilities'
import type {FilepathList} from '../../../types'
import {parseHtml} from './parse-html'

export interface ParsedHtmlAsset {
  css?: string[]
  js?: string[]
  // Subset of `js`: scripts declared `<script type="module">`, the only
  // scripts the browser parses as ES modules
  moduleJs?: string[]
  static?: string[]
}

const cloneParsedHtmlAsset = (assets: ParsedHtmlAsset): ParsedHtmlAsset => ({
  css: [...(assets.css || [])],
  js: [...(assets.js || [])],
  moduleJs: [...(assets.moduleJs || [])],
  static: [...(assets.static || [])]
})

const assetsFromHtmlCache = new Map<
  string,
  {key: string; assets: ParsedHtmlAsset}
>()

export function getAssetsFromHtml(
  htmlFilePath: string | undefined,
  htmlContent?: string,
  publicPath: string = 'public'
) {
  const assets: ParsedHtmlAsset = {
    css: [],
    js: [],
    moduleJs: [],
    static: []
  }

  if (!htmlFilePath) {
    return assets
  }

  let cacheKey: string | undefined

  if (htmlContent === undefined) {
    try {
      const stat = fs.statSync(htmlFilePath)
      cacheKey = `${stat.mtimeMs}:${stat.size}:${publicPath}`

      const cached = assetsFromHtmlCache.get(htmlFilePath)
      if (cached && cached.key === cacheKey) {
        return cloneParsedHtmlAsset(cached.assets)
      }
    } catch {
      cacheKey = undefined
    }
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

      if (isUrl(cleanPath)) {
        return cleanPath
      }

      if (cleanPath.startsWith('/')) {
        return cleanPath
      }
      const isBaseUrl = isUrl(baseHref || '')
      const baseJoin =
        baseHref && !isBaseUrl
          ? path.join(path.dirname(htmlFilePath), baseHref)
          : path.dirname(htmlFilePath)
      return path.join(baseJoin, cleanPath)
    }

    parseHtml(
      htmlDocument as ReturnType<typeof parse5utilities.createNode>,
      ({filePath, childNode, assetType}) => {
        const fileAbsolutePath = getAbsolutePath(htmlFilePath, filePath)

        switch (assetType) {
          case 'script': {
            assets.js?.push(fileAbsolutePath)
            // The HTML spec matches the module type ASCII case-insensitively
            const scriptType = childNode?.attrs?.find(
              (attr) => attr.name === 'type'
            )?.value
            if (String(scriptType || '').toLowerCase() === 'module') {
              assets.moduleJs?.push(fileAbsolutePath)
            }
            break
          }
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
      }
    )
  } catch (error) {
    return assets
  }

  if (cacheKey) {
    assetsFromHtmlCache.set(htmlFilePath, {
      key: cacheKey,
      assets: cloneParsedHtmlAsset(assets)
    })
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
      if (includePath === filePath) return true

      const assets = getAssetsFromHtml(includePath)
      return Boolean(
        assets?.js?.includes(filePath) || assets?.css?.includes(filePath)
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

export function isHttpLike(inputUrl: string): boolean {
  return /^https?:\/\//i.test(inputUrl) || inputUrl.startsWith('//')
}

export function isSpecialScheme(u: string): boolean {
  return /^(data:|blob:|chrome-extension:|javascript:|about:)/i.test(u)
}

export function cleanLeading(s: string): string {
  return s.replace(/^\/+/, '').replace(/^\.\//, '').replace(/^\./, '')
}

// Clamp the joined asset name the way Chrome resolves URLs: `..` cannot climb
// above the extension root, or the middleware writes outside dist and loops.
export function joinEmittedAssetName(prefix: string, rel: string): string {
  const parts = path.posix.join(prefix, rel).split('/')
  let i = 0
  while (i < parts.length && (parts[i] === '..' || parts[i] === '.')) i++
  return parts.slice(i).join('/') || path.posix.basename(rel)
}

export function computePosixRelative(fromPath: string, toPath: string): string {
  const fromRoot = path.parse(fromPath).root
  const toRoot = path.parse(toPath).root
  if (
    fromRoot &&
    toRoot &&
    String(fromRoot).toLowerCase() !== String(toRoot).toLowerCase()
  ) {
    // Cross-drive on Windows: fall back to basename to avoid absolute-in-assets
    const base = path.basename(toPath)
    return base.split(path.sep).join('/')
  }
  const rel = path.relative(path.dirname(fromPath), toPath) || toPath
  return rel.split(path.sep).join('/')
}

export function resolveAbsoluteFsPath(params: {
  asset: string
  projectRoot: string
  publicRootForResource: string
  outputRoot: string
  /** Manifest dir: Chrome resolves root URLs (/pages/x.html) against it. */
  manifestRoot?: string
}): {absoluteFsPath: string; isUnderPublicRoot: boolean; isRootUrl: boolean} {
  const {asset, projectRoot, publicRootForResource, outputRoot, manifestRoot} =
    params
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
        if (fs.existsSync(candidate)) return candidate
        // Chrome serves /pages/x.html manifest-relative; resolve the SOURCE file
        // there. Never fall back into outputRoot: re-reading emitted output loops.
        const manifestCandidate = manifestRoot
          ? path.join(manifestRoot, normalized)
          : ''
        if (manifestCandidate && fs.existsSync(manifestCandidate)) {
          return manifestCandidate
        }
        return manifestCandidate || candidate
      })()
    : isDotPublic
      ? path.join(projectRoot, cleanLeading(asset))
      : isPlainPublic
        ? path.join(projectRoot, asset.replace(/^\./, ''))
        : path.isAbsolute(asset)
          ? asset
          : path.join(projectRoot, asset)

  // Robust containment check using path.relative to handle Windows cases
  const relToPublic = path.relative(publicRootForResource, absoluteFsPath)
  const isUnderPublicRoot =
    relToPublic &&
    !relToPublic.startsWith('..') &&
    !path.isAbsolute(relToPublic)

  return {
    absoluteFsPath,
    isUnderPublicRoot: Boolean(isUnderPublicRoot),
    isRootUrl
  }
}

interface BaseHrefNode {
  nodeName?: string
  attrs?: Array<{name: string; value?: string}>
  childNodes?: BaseHrefNode[]
}

export function getBaseHref(htmlDocument: {
  childNodes?: unknown
}): string | undefined {
  const htmlChildren = (htmlDocument.childNodes || []) as BaseHrefNode[]
  for (const node of htmlChildren) {
    if (node?.nodeName !== 'html') continue
    for (const child of node.childNodes || []) {
      if (child?.nodeName !== 'head') continue
      for (const headChild of child.childNodes || []) {
        if (headChild?.nodeName === 'base') {
          const href = headChild.attrs?.find((a) => a.name === 'href')?.value
          if (href) return href
        }
      }
    }
  }
  return undefined
}
