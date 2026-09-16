//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {publicFolderOrDefault} from '../plugin-special-folders/resolve-public-folder'
import {replaceCssUrlRefs} from './css-lib/dead-url-refs'

export const PUBLIC_ROOT_SCHEME = 'https://extensionjs-public.invalid'

export interface PublicCssUrlLoaderOptions {
  manifestPath?: string
  projectPath?: string
}

interface PublicCssUrlLoaderContext {
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

export function keepPublicRootRefs(source: string, publicRoot: string): string {
  return replaceCssUrlRefs(source, (request) => {
    if (!request.startsWith('/') || request.startsWith('//')) return undefined

    const suffixAt = request.search(/[?#]/)
    const rel = (suffixAt === -1 ? request : request.slice(0, suffixAt)).slice(
      1
    )
    if (!rel || !isFile(path.join(publicRoot, rel))) return undefined

    return `${PUBLIC_ROOT_SCHEME}${request}`
  })
}

// The emitted sheet names the file the way the author did.
export function restorePublicRootRefs(source: string): string {
  return source.split(PUBLIC_ROOT_SCHEME).join('')
}

export default function publicCssUrlLoader(
  this: PublicCssUrlLoaderContext,
  source: string
): string {
  const {manifestPath, projectPath} = this.getOptions() || {}
  if (!manifestPath || !projectPath) return source

  try {
    const publicRoot = publicFolderOrDefault(manifestPath, projectPath)

    return keepPublicRootRefs(source, publicRoot)
  } catch {
    // A reference rewrite must never break a build the browser would accept.
    return source
  }
}
