//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Shared by the two paths that can spot a dead url(): the module graph, which
// sees an emitted stylesheet's child requests, and a text scan, which is the
// only way to reach a content-script stylesheet inlined as asset/inline.

import * as fs from 'node:fs'
import * as path from 'node:path'

const ASSET_EXT =
  /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp|cur|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav)$/i

const URL_REF = /url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)/g

export interface DeadUrlRefContext {
  issuerDir: string
  roots: string[]
}

/** True when the reference names no file under the issuer or any project root. */
export function isDeadCssUrlRef(
  rawRequest: string,
  {issuerDir, roots}: DeadUrlRefContext
): boolean {
  const req = String(rawRequest).split('?')[0].split('#')[0]
  if (!req || req.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(req)) {
    return false
  }
  if (req.startsWith('~') || req.startsWith('@')) return false

  const isRootRef = req.startsWith('/')
  const isRelativeRef = req.startsWith('./') || req.startsWith('../')
  const isBareAssetRef = !isRootRef && !isRelativeRef && ASSET_EXT.test(req)
  if (!isRootRef && !isRelativeRef && !isBareAssetRef) return false

  const candidates = isRootRef
    ? roots.map((root) => path.join(root, req.slice(1)))
    : [
        path.resolve(issuerDir, req),
        ...(isBareAssetRef ? roots.map((root) => path.join(root, req)) : [])
      ]

  return !candidates.some((candidate) => fs.existsSync(candidate))
}

/** Every url() target in a stylesheet, in source order, duplicates collapsed. */
export function extractCssUrlRefs(source: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  URL_REF.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = URL_REF.exec(source)) !== null) {
    const request = match[1] ?? match[2] ?? match[3] ?? ''
    if (!request || seen.has(request)) continue
    seen.add(request)
    found.push(request)
  }

  return found
}
