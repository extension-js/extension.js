//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {canonicalizeDir, canonicalizeResourcePath} from './resource-path'

const ASSET_EXT =
  /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp|cur|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav)$/i

const URL_REF = /url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)/gi

// A stylesheet path is shown the way the extension addresses it, whatever the
// host OS: path.relative hands back `content\\styles.css` on Windows.
export function toPosixPath(value: string): string {
  return String(value).split(path.sep).join('/')
}

// The text CSS reads from an address: `\2e ` and `\.` are both a period,
// and a backslash ahead of a line break joins the two lines.
export function unescapeCss(text: string): string {
  return String(text).replace(
    /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\s\S]))/gi,
    (_whole, hex: string | undefined, char: string | undefined) => {
      if (hex === undefined) return /^[\r\n\f]/.test(char || '') ? '' : char!

      const code = Number.parseInt(hex, 16)
      const valid =
        code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)

      return valid ? String.fromCodePoint(code) : '�'
    }
  )
}

const CHECKED_SHEETS = Symbol.for('extensionjs.css-checked-sheets')

// The sheets a page loader ran for, by the name rules match each as.
// A loader and a hook in two bundles share it, so it lives on the compiler.
export function checkedCssSheets(owner: object): Set<string> {
  const holder = owner as {[CHECKED_SHEETS]?: Set<string>}

  if (!holder[CHECKED_SHEETS]) holder[CHECKED_SHEETS] = new Set()

  return holder[CHECKED_SHEETS]
}

export interface DeadUrlRefContext {
  issuerDir: string
  roots: string[]
}

// Every file a url() request could name. None for a request that names no
// project file: a URL with a scheme, a data: URI, a package, a bare word.
export function cssUrlRefCandidates(
  rawRequest: string,
  {issuerDir, roots}: DeadUrlRefContext,
  pathApi: Pick<typeof path, 'join' | 'resolve'> = path
): string[] {
  const req = String(rawRequest).split('?')[0].split('#')[0]

  if (!req || req.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(req)) {
    return []
  }

  if (req.startsWith('~') || req.startsWith('@')) return []

  const isRootRef = req.startsWith('/')
  const isRelativeRef = req.startsWith('./') || req.startsWith('../')
  const isBareAssetRef = !isRootRef && !isRelativeRef && ASSET_EXT.test(req)
  if (!isRootRef && !isRelativeRef && !isBareAssetRef) return []

  return isRootRef
    ? roots.map((root) => pathApi.join(root, req.slice(1)))
    : [
        pathApi.resolve(issuerDir, req),
        ...(isBareAssetRef ? roots.map((root) => pathApi.join(root, req)) : [])
      ]
}

// The same files, plus the .css sheet an @import names without its extension.
export function cssUrlRefFiles(
  rawRequest: string,
  context: DeadUrlRefContext
): string[] {
  const candidates = cssUrlRefCandidates(rawRequest, context)
  const req = String(rawRequest).split('?')[0].split('#')[0]

  return path.extname(req)
    ? candidates
    : [...candidates, ...candidates.map((candidate) => `${candidate}.css`)]
}

export function isDeadCssUrlRef(
  rawRequest: string,
  context: DeadUrlRefContext
): boolean {
  const candidates = cssUrlRefFiles(rawRequest, context)

  return (
    candidates.length > 0 &&
    !candidates.some((candidate) => fs.existsSync(candidate))
  )
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

// An @import can name its sheet with a bare string, where no url() is read.
const IMPORT_STRING_REF = /@import\s+(?:"([^"\n]*)"|'([^'\n]*)')/gi

export function extractCssUrlRefs(source: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const comments = commentRanges(source)

  for (const pattern of [URL_REF, IMPORT_STRING_REF]) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(source)) !== null) {
      const at = match.index
      if (comments.some(([start, end]) => at >= start && at < end)) continue

      const request = match[1] ?? match[2] ?? match[3] ?? ''
      if (!request || seen.has(request)) continue
      // Loader syntax marks a module request some loader built, not a file.
      if (pattern === IMPORT_STRING_REF && request.includes('!')) continue

      seen.add(request)
      found.push(request)
    }
  }

  return found
}
