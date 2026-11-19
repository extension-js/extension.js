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
import {isOsPathUnder} from '../../../lib/real-path'
import {hasPrivateFileName} from '../../../plugin-special-folders/public-private-files'
import {
  type AssetHashOptions,
  bundledAssetOutputName
} from '../../../plugin-static-assets/static-assets-lib/asset-output-name'
import type {FilepathList} from '../../../types'
import {externalAssetOutputPath} from '../../feature-manifest/normalize-manifest-path'
import {type HtmlStaticAttribute, parseHtml} from './parse-html'

export interface ParsedHtmlAsset {
  css?: string[]
  js?: string[]
  // Subset of `js`: scripts declared `<script type="module">`, the only
  // scripts the browser parses as ES modules
  moduleJs?: string[]
  static?: string[]
  // Resolved path to the reference as the author typed it
  authored?: Record<string, string>
}

const cloneParsedHtmlAsset = (assets: ParsedHtmlAsset): ParsedHtmlAsset => ({
  css: [...(assets.css || [])],
  js: [...(assets.js || [])],
  moduleJs: [...(assets.moduleJs || [])],
  static: [...(assets.static || [])],
  authored: {...(assets.authored || {})}
})

const assetsFromHtmlCache = new Map<
  string,
  {key: string; assets: ParsedHtmlAsset}
>()

export function getAssetsFromHtml(
  htmlFilePath: string | undefined,
  htmlContent?: string
) {
  const assets: ParsedHtmlAsset = {
    css: [],
    js: [],
    moduleJs: [],
    static: [],
    authored: {}
  }

  if (!htmlFilePath) {
    return assets
  }

  let cacheKey: string | undefined

  if (htmlContent === undefined) {
    try {
      const stat = fs.statSync(htmlFilePath)
      cacheKey = `${stat.mtimeMs}:${stat.size}`

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

      return resolveHtmlRefPath(htmlFilePath, baseHref, cleanPath)
    }

    parseHtml(
      htmlDocument as ReturnType<typeof parse5utilities.createNode>,
      ({filePath, childNode, assetType}) => {
        const fileAbsolutePath = getAbsolutePath(htmlFilePath, filePath)

        const keepAuthored = () => {
          if (assets.authored && !(fileAbsolutePath in assets.authored)) {
            assets.authored[fileAbsolutePath] = filePath
          }
        }

        switch (assetType) {
          case 'script': {
            assets.js?.push(fileAbsolutePath)
            keepAuthored()
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
            keepAuthored()
            break
          case 'staticSrc':
          case 'staticHref':
            // An empty attribute names no file, the browser fetches nothing
            if (!filePath.trim() || filePath.startsWith('#')) {
              break
            }

            assets.static?.push(fileAbsolutePath)
            keepAuthored()
            break
          default:
            break
        }
      }
    )
  } catch (error) {
    // A deleted HTML file must error, not report an empty page: callers gate
    // on existsSync when a missing file is a state they expect and handle.
    const code = (error as NodeJS.ErrnoException | undefined)?.code

    if (htmlContent === undefined && code === 'ENOENT') {
      assetsFromHtmlCache.delete(htmlFilePath)

      throw error
    }

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

// The local scripts and stylesheets a page names that have no file. The
// entry step leaves exactly these out, by the same test: a remote URL and
// a root URL are not files the bundler would have compiled.
export function missingPageEntryFiles(
  htmlFilePath: string,
  projectRoot: string,
  htmlContent?: string
): string[] {
  const assets = getAssetsFromHtml(htmlFilePath, htmlContent)
  const refs = [...(assets?.js || []), ...(assets?.css || [])]

  return [...new Set(refs)].filter(
    (ref) =>
      path.isAbsolute(ref) &&
      !/^(https?:)?\/\//i.test(ref) &&
      !ref.startsWith('/public/') &&
      !(ref.startsWith('/') && !ref.startsWith(projectRoot)) &&
      !fs.existsSync(ref)
  )
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

      if (!includePath || !fs.existsSync(includePath)) return false

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

// A drive letter parses as a one-letter URL scheme, yet `C:\x` is a path.
export function isDrivePath(src: string): boolean {
  return /^[a-z]:[\\/]/i.test(src)
}

export function isUrl(src: string) {
  if (isDrivePath(src)) return false

  try {
    // eslint-disable-next-line no-new
    new URL(src)

    return true
  } catch (err) {
    return false
  }
}

export type {HtmlStaticAttribute}

export function resolveStaticAttributeName(
  assetType: 'staticSrc' | 'staticHref',
  attributeName?: HtmlStaticAttribute
): HtmlStaticAttribute {
  if (attributeName) return attributeName

  return assetType === 'staticSrc' ? 'src' : 'href'
}

// Replace one srcset/imagesrcset candidate URL, leaving descriptors and
// sibling candidates intact so the browser still sees the author's list.
export function rewriteSrcsetCandidate(
  srcset: string,
  fromCleanPath: string,
  toUrl: string
): string {
  return srcset
    .split(',')
    .map((candidate) => {
      const match = candidate.match(/^(\s*)(\S+)(.*)$/)
      if (!match) return candidate

      const [, lead, url, rest] = match
      const {cleanPath} = cleanAssetUrl(url)

      if (cleanPath !== fromCleanPath && url !== fromCleanPath) {
        return candidate
      }

      return `${lead}${toUrl}${rest}`
    })
    .join(',')
}

export function applyRewrittenStaticUrl(
  node: parse5utilities.ParsedNode,
  attributeName: HtmlStaticAttribute,
  cleanPath: string,
  value: string
): parse5utilities.ParsedNode {
  if (attributeName === 'srcset' || attributeName === 'imagesrcset') {
    const current = parse5utilities.getAttribute(node, attributeName) || ''

    return parse5utilities.setAttribute(
      node,
      attributeName,
      rewriteSrcsetCandidate(current, cleanPath, value)
    )
  }

  return parse5utilities.setAttribute(node, attributeName, value)
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

// Whether a script or stylesheet path is a root URL. A relative reference
// that climbs out of the project resolves to a path that also starts with
// a slash, so the reference as written decides when it is known.
export function isWrittenAsRootUrl(
  resolved: string,
  projectRoot: string,
  authored?: Record<string, string>
): boolean {
  if (!resolved.startsWith('/') || resolved.startsWith(projectRoot)) {
    return false
  }

  const written = authored?.[resolved]

  return written === undefined || written.startsWith('/')
}

// A leading dot belongs to the name: `/.well-known/x` is not `well-known/x`.
export function cleanLeading(s: string): string {
  return s.replace(/^\/+/, '').replace(/^(?:\.\/)+/, '')
}

// A root URL as a path inside the extension root. The browser resolves `..`
// before it asks, and never above the root.
export function rootUrlPath(rootUrl: string): string {
  return path.posix.normalize(`/${cleanLeading(rootUrl)}`).slice(1)
}

// Clamp the joined asset name the way Chrome resolves URLs: `..` cannot climb
// above the extension root, or the middleware writes outside dist and loops.
export function joinEmittedAssetName(prefix: string, rel: string): string {
  const parts = path.posix.join(prefix, rel).split('/')
  let i = 0
  while (i < parts.length && (parts[i] === '..' || parts[i] === '.')) i++

  return parts.slice(i).join('/') || path.posix.basename(rel)
}

const pageFileBytes = new WeakMap<object, Map<string, Buffer>>()

// One read of a file per compilation. The emit step and the page rewrite
// both name the copy from its bytes, and the bytes they name are the copy.
export function readPageFile(
  compilation: object | undefined,
  absolutePath: string
): Buffer {
  if (!compilation) return fs.readFileSync(absolutePath)

  let byPath = pageFileBytes.get(compilation)

  if (!byPath) {
    byPath = new Map<string, Buffer>()
    pageFileBytes.set(compilation, byPath)
  }

  const known = byPath.get(absolutePath)
  if (known) return known

  const bytes = fs.readFileSync(absolutePath)
  byPath.set(absolutePath, bytes)

  return bytes
}

// Output name of a static asset an html page references: the name the
// bundler gives the same file from a stylesheet or an import, so one build
// ships one copy however many places name it. A nested page keeps its
// manifest-relative path under assets/, or a stable slot there when it sits
// outside the root. Without a manifest dir the name is page-relative.
export function htmlStaticAssetOutputName(
  manifestDir: string | undefined,
  htmlEntry: string,
  absolutePath: string,
  output?: AssetHashOptions,
  compilation?: object
): string {
  if (!/\.html?$/i.test(absolutePath)) {
    try {
      return bundledAssetOutputName(
        absolutePath,
        readPageFile(compilation, absolutePath),
        output
      )
    } catch {
      // A missing file still gets a name, for the warning that follows.
    }
  }

  if (typeof manifestDir === 'string' && manifestDir) {
    const rel = path.relative(manifestDir, absolutePath)

    if (rel && !path.isAbsolute(rel)) {
      const posix = rel.split(path.sep).join('/')
      const escapes = posix.split('/').includes('..')

      return escapes
        ? externalAssetOutputPath(posix, 'assets')
        : joinEmittedAssetName('assets', posix)
    }
  }

  return joinEmittedAssetName(
    'assets',
    computePosixRelative(htmlEntry, absolutePath)
  )
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
  manifestRoot?: string
}): {absoluteFsPath: string; isUnderPublicRoot: boolean; isRootUrl: boolean} {
  const {asset, projectRoot, publicRootForResource, outputRoot, manifestRoot} =
    params
  const looksLikeRootUrl =
    asset.startsWith('/') &&
    !(
      isOsPathUnder(projectRoot, asset) ||
      isOsPathUnder(publicRootForResource, asset) ||
      isOsPathUnder(outputRoot, asset)
    )

  // The copier leaves a private name out, so public/ does not answer for it.
  const publicHolds = (relative: string) =>
    !hasPrivateFileName(relative) &&
    fs.existsSync(path.join(publicRootForResource, relative))

  // A page ref that climbs out of the project root arrives as an absolute
  // path that also starts with '/'. It is a root URL only when the
  // extension root claims it or no such file exists on disk.
  const rootUrlIsClaimed = (value: string) => {
    const normalized = rootUrlPath(value)
    const withoutPublicPrefix = normalized.replace(/^public\//, '')

    if (publicHolds(withoutPublicPrefix)) return true

    return Boolean(
      manifestRoot && fs.existsSync(path.join(manifestRoot, normalized))
    )
  }

  const isRootUrl =
    looksLikeRootUrl && (rootUrlIsClaimed(asset) || !fs.existsSync(asset))
  const isDotPublic = asset.startsWith('./public/')
  const isPlainPublic = asset.startsWith('public/')

  const absoluteFsPath = isRootUrl
    ? (() => {
        const normalized = rootUrlPath(asset)
        const withoutPublicPrefix = normalized.replace(/^public\//, '')
        const candidate = path.join(publicRootForResource, withoutPublicPrefix)
        if (publicHolds(withoutPublicPrefix)) return candidate

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

// One answer for every consumer to where a page ref points on disk: a
// relative <base href> joins first (the collector spec pins this, /public
// refs stay unbased), and a ref the base misses falls back to the page's
// own folder so the build ships the file the author has.
export function resolveHtmlRefPath(
  htmlFilePath: string,
  baseHref: string | undefined,
  cleanPath: string
): string {
  if (isUrl(cleanPath)) return cleanPath
  if (cleanPath.startsWith('/') || isDrivePath(cleanPath)) return cleanPath

  const htmlDir = path.dirname(htmlFilePath)
  const pageRelative = path.join(htmlDir, cleanPath)
  if (!baseHref || isUrl(baseHref)) return pageRelative

  const throughBase = path.join(htmlDir, baseHref, cleanPath)

  if (fs.existsSync(throughBase) || !fs.existsSync(pageRelative)) {
    return throughBase
  }

  return pageRelative
}

export function getBaseHref(htmlDocument: {
  childNodes?: unknown
}): string | undefined {
  return getBaseNode(htmlDocument)?.attrs?.find((a) => a.name === 'href')?.value
}

export function getBaseNode(htmlDocument: {
  childNodes?: unknown
}): BaseHrefNode | undefined {
  const htmlChildren = (htmlDocument.childNodes || []) as BaseHrefNode[]

  for (const node of htmlChildren) {
    if (node?.nodeName !== 'html') continue

    for (const child of node.childNodes || []) {
      if (child?.nodeName !== 'head') continue

      for (const headChild of child.childNodes || []) {
        if (headChild?.nodeName === 'base') {
          const href = headChild.attrs?.find((a) => a.name === 'href')?.value
          if (href) return headChild
        }
      }
    }
  }

  return undefined
}
