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
  canonicalizeDir,
  canonicalizeResourcePath
} from '../../lib/resource-path'

const ASSET_EXT =
  /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp|cur|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav)$/i

const URL_REF = /url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)/gi

// A stylesheet path is shown the way the extension addresses it, so it must not
// change shape with the host OS: path.relative hands back `content\\styles.css`
// on Windows, and the same defect then reads as two different messages.
export function toPosixPath(value: string): string {
  return String(value).split(path.sep).join('/')
}

export interface DeadUrlRefContext {
  issuerDir: string
  roots: string[]
}

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

// A file inside the folder the public copier ships is already at the output
// root, under its path inside that folder, however the reference spelled it.
export function publicOwnedOutputName(
  absolutePath: string,
  publicDir: string | undefined
): string | undefined {
  if (!publicDir) return undefined

  const rel = path.relative(
    canonicalizeDir(publicDir),
    canonicalizeResourcePath(absolutePath)
  )

  if (!rel || path.isAbsolute(rel) || rel.split(path.sep)[0] === '..') {
    return undefined
  }

  return toPosixPath(rel)
}

export interface CssUrlRef {
  isImport: boolean
}

export function replaceCssUrlRefs(
  source: string,
  replacer: (request: string, ref: CssUrlRef) => string | undefined
): string {
  return source.replace(URL_REF, (whole, dq, sq, bare, offset: number) => {
    const request = dq ?? sq ?? bare ?? ''
    if (!request) return whole

    const before = source.slice(Math.max(0, offset - 32), offset)
    const next = replacer(request, {isImport: /@import\s*$/i.test(before)})
    if (next === undefined) return whole

    return `url("${next.replace(/["\\]/g, '\\$&')}")`
  })
}

// Where each comment of a sheet starts and ends. Strings, escapes and an
// unquoted url() body are read the way CSS reads them, so a /* there opens none.
function commentRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let at = 0

  while (at < source.length) {
    const char = source[at]

    if (char === '\\') {
      at += 2
    } else if (char === '"' || char === "'") {
      at++

      while (at < source.length && source[at] !== char && source[at] !== '\n') {
        at += source[at] === '\\' ? 2 : 1
      }

      at++
    } else if (char === '/' && source[at + 1] === '*') {
      const end = source.indexOf('*/', at + 2)
      const close = end === -1 ? source.length : end + 2

      ranges.push([at, close])
      at = close
    } else if (/^url\(\s*[^\s'"]/i.test(source.slice(at, at + 64))) {
      const close = source.indexOf(')', at)

      at = close === -1 ? source.length : close + 1
    } else {
      at++
    }
  }

  return ranges
}

export function extractCssUrlRefs(source: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const comments = commentRanges(source)

  URL_REF.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = URL_REF.exec(source)) !== null) {
    const at = match.index
    if (comments.some(([start, end]) => at >= start && at < end)) continue

    const request = match[1] ?? match[2] ?? match[3] ?? ''
    if (!request || seen.has(request)) continue

    seen.add(request)
    found.push(request)
  }

  return found
}
