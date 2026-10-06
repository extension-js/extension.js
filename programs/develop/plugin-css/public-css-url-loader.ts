//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  publicContainmentRoot,
  resolvePublicFolder
} from '../plugin-special-folders/resolve-public-folder'
import {publicOwnedOutputName, replaceCssUrlRefs} from './css-lib/dead-url-refs'

export const PUBLIC_ROOT_SCHEME = 'https://extensionjs-public.invalid'

export interface PublicCssUrlLoaderOptions {
  manifestPath?: string
  projectPath?: string
}

interface PublicCssUrlLoaderContext {
  resourcePath?: string
  getOptions(): PublicCssUrlLoaderOptions
  addDependency?(file: string): void
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

  return publicOwnedOutputName(absolutePath, publicDir)
}

export function keepPublicRootRefs(
  source: string,
  publicRoot: string,
  relative?: PublicRelativeRefs
): string {
  return replaceCssUrlRefs(source, (request, {isImport}) => {
    if (request.startsWith('//')) return undefined

    const suffixAt = request.search(/[?#]/)
    const req = suffixAt === -1 ? request : request.slice(0, suffixAt)

    if (req.startsWith('/')) {
      const rel = req.slice(1)
      if (!rel || !isFile(path.join(publicRoot, rel))) return undefined

      return `${PUBLIC_ROOT_SCHEME}${request}`
    }

    // A relative @import is bundled into the sheet, so it stays a request.
    if (!relative || isImport) return undefined

    const publicPath = publicPathOfRelativeRef(req, relative)
    if (!publicPath) return undefined

    return `${PUBLIC_ROOT_SCHEME}/${publicPath}${request.slice(req.length)}`
  })
}

export default function publicCssUrlLoader(
  this: PublicCssUrlLoaderContext,
  source: string
): string {
  const {manifestPath, projectPath} = this.getOptions() || {}
  if (!manifestPath || !projectPath) return source

  try {
    const publicRoot = publicContainmentRoot(manifestPath, projectPath)
    const publicDir = resolvePublicFolder(manifestPath, projectPath)

    return keepPublicRootRefs(
      source,
      publicRoot,
      publicDir && this.resourcePath
        ? {issuerDir: path.dirname(this.resourcePath), publicDir}
        : undefined
    )
  } catch {
    // A reference rewrite must never break a build the browser would accept.
    return source
  }
}
