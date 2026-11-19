//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {toProjectRelativePath} from '../lib/resource-path'
import {
  hasPrivateFileName,
  rootAbsolutePathIsWithheld
} from '../plugin-special-folders/public-private-files'
import {
  publicContainmentRoot,
  resolvePublicFolder
} from '../plugin-special-folders/resolve-public-folder'
import {checkedCssSheets, publicOwnedOutputName} from './css-lib/dead-url-refs'
import {rewriteCssUrls} from './css-lib/inline-css-imports'
import {lineRewriteSourceMap} from './css-lib/line-rewrite-source-map'
import * as messages from './css-lib/messages'

export const PUBLIC_ROOT_SCHEME = 'https://extensionjs-public.invalid'

export interface PublicCssUrlLoaderOptions {
  manifestPath?: string
  projectPath?: string
  // The sheet ships as a file of its own (?url), away from its folder.
  standalone?: boolean
}

interface PublicCssUrlLoaderContext {
  resourcePath?: string
  getOptions(): PublicCssUrlLoaderOptions
  emitWarning?(warning: Error): void
  addDependency?(file: string): void
  callback(error: null, content: string, map?: unknown): void
  _compiler?: object
  _module?: {nameForCondition?(): string | null | undefined}
}

// Notes that this sheet ran here, so the resolve hook checks every file
// it leads to. The two live in two bundles and share the compiler.
function noteCheckedSheet(loader: PublicCssUrlLoaderContext) {
  const name = loader._module?.nameForCondition?.() || loader.resourcePath
  if (!loader._compiler || !name) return

  checkedCssSheets(loader._compiler).add(name)
}

function isFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

export interface PublicRelativeRefs {
  issuerDir: string
  // The folder the public copier ships from.
  publicDir: string
}

function publicPathOfRelativeRef(
  req: string,
  {issuerDir, publicDir}: PublicRelativeRefs
): string | undefined {
  if (!req || /^[a-z][a-z0-9+.-]*:/i.test(req)) return undefined
  if (req.startsWith('~') || req.startsWith('@')) return undefined

  const absolutePath = path.resolve(issuerDir, req)
  if (!isFile(absolutePath)) return undefined

  const publicPath = publicOwnedOutputName(absolutePath, publicDir)

  // The copier leaves these names out, so public/ does not hold them.
  return publicPath && !hasPrivateFileName(publicPath) ? publicPath : undefined
}

export function keepPublicRootRefs(
  source: string,
  publicRoot: string,
  relative?: PublicRelativeRefs
): string {
  // Read the way CSS reads it, so a url( inside a string is left alone.
  return rewriteCssUrls(
    source,
    (request, where) => {
      if (where !== 'url' && where !== 'import-url') return undefined
      if (request.startsWith('//')) return undefined

      const isImport = where === 'import-url'

      const suffixAt = request.search(/[?#]/)
      const req = suffixAt === -1 ? request : request.slice(0, suffixAt)

      if (req.startsWith('/')) {
        const rel = req.slice(1)
        if (!rel || rootAbsolutePathIsWithheld(req)) return undefined
        if (!isFile(path.join(publicRoot, rel))) return undefined

        return `${PUBLIC_ROOT_SCHEME}${request}`
      }

      // A relative @import is bundled into the sheet, so it stays a request.
      if (!relative || isImport) return undefined

      const publicPath = publicPathOfRelativeRef(req, relative)
      if (!publicPath) return undefined

      return `${PUBLIC_ROOT_SCHEME}/${publicPath}${request.slice(req.length)}`
    },
    true
  )
}

// The addresses a sheet shipped away from its folder cannot load: any that
// is not a full URL, a root path or a fragment.
export function refsAStandaloneSheetLoses(css: string): string[] {
  const lost = new Set<string>()

  rewriteCssUrls(css, (request) => {
    if (!/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(request)) lost.add(request)

    return undefined
  })

  return [...lost]
}

export default function publicCssUrlLoader(
  this: PublicCssUrlLoaderContext,
  source: string,
  map?: unknown
): void {
  const {manifestPath, projectPath, standalone} = this.getOptions() || {}
  let rewritten = source

  if (manifestPath && projectPath) {
    noteCheckedSheet(this)

    try {
      const publicRoot = publicContainmentRoot(manifestPath, projectPath)
      const publicDir = resolvePublicFolder(manifestPath, projectPath)

      rewritten = keepPublicRootRefs(
        source,
        publicRoot,
        publicDir && this.resourcePath
          ? {issuerDir: path.dirname(this.resourcePath), publicDir}
          : undefined
      )
    } catch (error) {
      // A reference rewrite must never break a build the browser would accept.
      this.emitWarning?.(
        Object.assign(
          new Error(
            messages.cssUrlRewriteSkipped(this.resourcePath || '', error)
          ),
          {name: 'CssUrlRewriteWarning'}
        )
      )
    }
  }

  const lost = standalone ? refsAStandaloneSheetLoses(rewritten) : []

  if (lost.length > 0) {
    this.emitWarning?.(
      Object.assign(
        new Error(
          messages.cssUrlSheetRefsNotFollowed(
            toProjectRelativePath(projectPath, this.resourcePath || ''),
            lost
          )
        ),
        {name: 'CssUrlRewriteWarning'}
      )
    )
  }

  // The map a devtools panel reads must show the author's url(), not the
  // placeholder host, so a rewrite with no map ahead of it makes its own.
  this.callback(
    null,
    rewritten,
    map ??
      (rewritten === source
        ? undefined
        : lineRewriteSourceMap(source, rewritten, this.resourcePath || ''))
  )
}
