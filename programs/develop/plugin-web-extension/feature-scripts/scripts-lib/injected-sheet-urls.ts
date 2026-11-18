// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {
  isChromiumBasedBrowser,
  isGeckoBasedBrowser
} from '../../../lib/constants'
import {replaceCssUrlRefs} from '../../../plugin-css/css-lib/dead-url-refs'
import {
  browserSpellings,
  climbsOut
} from '../../../plugin-special-folders/public-private-files'
import {parseCanonicalContentScriptAsset} from '../contracts'
import {runtimeScriptSheetName} from './runtime-script-sheet'

// Chromium fills the id in as it loads a sheet from the extension, in the
// manifest css list, a registration and an insertCSS file alike.
export const CHROMIUM_EXTENSION_ROOT =
  'chrome-extension://__MSG_@@extension_id__/'

// Firefox fills the id in as it serves the file, so a sheet a script fetches
// and places itself reads the same address the injected one does.
export const GECKO_EXTENSION_ROOT = 'moz-extension://__MSG_@@extension_id__/'

// Undefined for an engine no measurement covers, whose sheet keeps its bytes.
export function injectedSheetRoot(browser: string): string | undefined {
  if (isChromiumBasedBrowser(browser)) return CHROMIUM_EXTENSION_ROOT
  if (isGeckoBasedBrowser(browser)) return GECKO_EXTENSION_ROOT

  return undefined
}

// A sheet the browser puts on the visited page itself, by its emitted name.
export function isInjectedSheet(
  assetName: string,
  runtimeEntries: string[]
): boolean {
  if (parseCanonicalContentScriptAsset(assetName)?.extension === 'css') {
    return true
  }

  return runtimeEntries.some(
    (entryName) => runtimeScriptSheetName(entryName) === assetName
  )
}

// A sheet on the visited page reads a url() against that page, injected on
// Chromium or placed by a script on Firefox, so a root target names the extension.
export function rootedAtExtension(
  css: string,
  root: string = CHROMIUM_EXTENSION_ROOT
): string {
  return replaceCssUrlRefs(css, (request) =>
    request.startsWith('/') && !request.startsWith('//')
      ? `${root}${request.slice(1)}`
      : undefined
  )
}

// The sheets an injection call names by file, kept for one compilation so
// the step that roots their targets knows them from a sheet a page links.
const namedSheets = new WeakMap<object, Set<string>>()

export function noteNamedInjectedSheet(compilation: object, assetName: string) {
  const names = namedSheets.get(compilation) ?? new Set<string>()

  names.add(assetName)
  namedSheets.set(compilation, names)
}

export function namedInjectedSheets(compilation: object): ReadonlySet<string> {
  return namedSheets.get(compilation) ?? new Set<string>()
}

// A target that climbs out of the extension root from the sheet's folder,
// as written or as the browser decodes it, names no file the build ships.
export function climbsOutOfSheetRoot(
  request: string,
  sheetName: string
): boolean {
  const target = request.trim().split(/[?#]/)[0]

  if (!target || target.startsWith('//') || /^[a-z][\w+.-]*:/i.test(target)) {
    return false
  }

  const fromRoot = target.startsWith('/')
    ? target.replace(/^\/+/, '')
    : path.posix.join(path.posix.dirname(sheetName.replace(/\\/g, '/')), target)

  return browserSpellings(fromRoot).some(climbsOut)
}

// The address of one url() target of a sheet at the given output name,
// undefined for a target that reads the same from any page.
function namedFromExtension(
  request: string,
  sheetName: string,
  root: string
): string | undefined {
  const target = request.trim()

  if (
    !target ||
    target.startsWith('#') ||
    target.startsWith('//') ||
    /^[a-z][\w+.-]*:/i.test(target) ||
    climbsOutOfSheetRoot(target, sheetName)
  ) {
    return undefined
  }

  try {
    const resolved = new URL(
      target,
      `chrome-extension://extension-js/${sheetName.replace(/\\/g, '/')}`
    )

    return `${root}${resolved.pathname.slice(1)}${resolved.search}${resolved.hash}`
  } catch {
    return undefined
  }
}

// A sheet shipped as written spells its targets from its own folder, which
// Chromium reads against the visited page, so each one is named in full.
export function rootedAtExtensionFrom(
  css: string,
  sheetName: string,
  root: string = CHROMIUM_EXTENSION_ROOT
): string {
  // Chromium drops an @import in a sheet it injects, however it is spelled.
  return replaceCssUrlRefs(css, (request, ref) =>
    ref.isImport ? undefined : namedFromExtension(request, sheetName, root)
  )
}

export interface PageRelativeTarget {
  request: string
  line: number
  named: string
}

// The first url() of a sheet Chromium would read against the visited page,
// with the spelling that names the same file from the extension.
export function firstPageRelativeTarget(
  css: string,
  sheetName: string,
  root: string = CHROMIUM_EXTENSION_ROOT
): PageRelativeTarget | undefined {
  let first: PageRelativeTarget | undefined
  let seen = 0

  replaceCssUrlRefs(css, (request, ref) => {
    const at = css.indexOf(request, seen)
    seen = at === -1 ? seen : at + request.length

    const named = ref.isImport
      ? undefined
      : namedFromExtension(request, sheetName, root)

    if (!first && named) {
      first = {
        request: request.trim(),
        line: css.slice(0, Math.max(0, at)).split('\n').length,
        named
      }
    }

    return undefined
  })

  return first
}

// The files such a sheet loads from the page it lands on, by sheet, for
// the step that decides which files a page may fetch.
const sheetTargets = new WeakMap<object, Map<string, Set<string>>>()

export function noteInjectedSheetTarget(
  compilation: object,
  sheetName: string,
  target: string
) {
  const bySheet = sheetTargets.get(compilation) ?? new Map()
  const targets: Set<string> = bySheet.get(sheetName) ?? new Set()

  targets.add(target)
  bySheet.set(sheetName, targets)
  sheetTargets.set(compilation, bySheet)
}

export function injectedSheetTargets(
  compilation: object
): ReadonlyMap<string, ReadonlySet<string>> {
  return sheetTargets.get(compilation) ?? new Map()
}

// The sheets under public/ an injection call names. They ship byte for
// byte, so what Chromium does with them is said and never rewritten.
const publicSheets = new WeakMap<object, Set<string>>()

export function notePublicInjectedSheet(
  compilation: object,
  assetName: string
) {
  const names = publicSheets.get(compilation) ?? new Set<string>()

  names.add(assetName)
  publicSheets.set(compilation, names)
}

export function publicInjectedSheets(compilation: object): ReadonlySet<string> {
  return publicSheets.get(compilation) ?? new Set<string>()
}

export interface SheetImport {
  start: number
  end: number
  line: number
  request: string
  // True for a bare layer keyword, the name for layer(name).
  layer?: string | true
  supports?: string
  media?: string
}

// The index after a string, a comment or a balanced parenthesis that opens
// at the given index, so a semicolon inside one never ends a rule.
function skipGroup(css: string, at: number): number {
  const open = css[at]

  if (open === '"' || open === "'") {
    for (let i = at + 1; i < css.length; i++) {
      if (css[i] === '\\') i++
      else if (css[i] === open || css[i] === '\n') return i + 1
    }

    return css.length
  }

  if (open === '/' && css[at + 1] === '*') {
    const close = css.indexOf('*/', at + 2)

    return close === -1 ? css.length : close + 2
  }

  if (open === '(') {
    let i = at + 1

    while (i < css.length && css[i] !== ')') {
      const next = skipGroup(css, i)
      i = next === i ? i + 1 : next
    }

    return Math.min(css.length, i + 1)
  }

  return at
}

function parseImportPrelude(
  prelude: string
): Omit<SheetImport, 'start' | 'end' | 'line'> | undefined {
  const text = prelude.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
  const target =
    /^url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)/i.exec(text) ||
    /^(?:"([^"\n]*)"|'([^'\n]*)')/.exec(text)
  if (!target) return undefined

  const found: Omit<SheetImport, 'start' | 'end' | 'line'> = {
    request: (target[1] ?? target[2] ?? target[3] ?? '').trim()
  }
  let rest = text.slice(target[0].length).trim()

  if (/^layer\(/i.test(rest)) {
    const end = skipGroup(rest, 5)

    found.layer = rest.slice(6, end - 1).trim()
    rest = rest.slice(end).trim()
  } else if (/^layer(?:\s|$)/i.test(rest)) {
    found.layer = true
    rest = rest.slice(5).trim()
  }

  if (/^supports\(/i.test(rest)) {
    const end = skipGroup(rest, 8)

    found.supports = rest.slice(9, end - 1).trim()
    rest = rest.slice(end).trim()
  }

  if (rest) found.media = rest

  return found
}

// The @import rules a browser honors: the ones ahead of every other rule,
// where only @charset and a layer order statement may come first.
export function leadingSheetImports(css: string): SheetImport[] {
  const imports: SheetImport[] = []
  let i = 0

  while (i < css.length) {
    if (/\s/.test(css[i])) {
      i++
      continue
    }

    if (css.startsWith('/*', i)) {
      i = skipGroup(css, i)
      continue
    }

    const rule = /^@(import|charset|layer)(?![\w-])/i.exec(css.slice(i, i + 9))
    if (!rule) break

    let end = i + rule[0].length

    while (end < css.length && css[end] !== ';' && css[end] !== '{') {
      const next = skipGroup(css, end)
      end = next === end ? end + 1 : next
    }

    // A layer block, or a rule the file ends inside of, is no statement.
    if (css[end] !== ';') break

    if (rule[1].toLowerCase() === 'import') {
      const parsed = parseImportPrelude(css.slice(i + rule[0].length, end))

      if (parsed?.request) {
        imports.push({
          ...parsed,
          start: i,
          end: end + 1,
          line: css.slice(0, i).split('\n').length
        })
      }
    }

    i = end + 1
  }

  return imports
}

export interface SkippedSheetImport {
  sheet: string
  line: number
  request: string
  reason: 'remote' | 'missing'
}

// The output name an @import asks for, undefined for one another origin
// serves, which no build can read.
function importedSheetName(request: string, sheetName: string) {
  const target = request.replace(
    /^(?:chrome|moz)-extension:\/\/__MSG_@@extension_id__\//i,
    '/'
  )

  if (target.startsWith('//') || /^[a-z][\w+.-]*:/i.test(target)) {
    return undefined
  }

  try {
    const resolved = new URL(
      target,
      `chrome-extension://extension-js/${sheetName.replace(/\\/g, '/')}`
    )

    return decodeURIComponent(resolved.pathname.slice(1))
  } catch {
    return undefined
  }
}

function underImportConditions(css: string, rule: SheetImport): string {
  let out = css.replace(/^\s*@charset\s+[^;]*;/i, '').trim()

  if (rule.layer !== undefined) {
    out = `@layer${rule.layer === true ? '' : ` ${rule.layer}`} {\n${out}\n}`
  }

  if (rule.media) out = `@media ${rule.media} {\n${out}\n}`

  if (rule.supports) out = `@supports (${rule.supports}) {\n${out}\n}`

  return out
}

// Chromium drops an @import in a sheet it injects, so the imported rules
// are written in its place, each url() named from its own file's folder.
export function inlinedInjectedSheet(
  css: string,
  sheetName: string,
  options: {
    root?: string
    read: (assetName: string) => string | undefined
    onSkipped?: (skipped: SkippedSheetImport) => void
  },
  ancestors: readonly string[] = []
): string {
  const chain = [...ancestors, sheetName]
  let out = ''
  let at = 0

  for (const rule of leadingSheetImports(css)) {
    const imported = importedSheetName(rule.request, sheetName)
    const text = imported === undefined ? undefined : options.read(imported)
    let inlined: string

    if (imported !== undefined && chain.includes(imported)) {
      // A browser loads a sheet that imports itself once and stops there.
      inlined = ''
    } else if (imported === undefined || text === undefined) {
      options.onSkipped?.({
        sheet: sheetName,
        line: rule.line,
        request: rule.request,
        reason: imported === undefined ? 'remote' : 'missing'
      })

      inlined = css.slice(rule.start, rule.end)
    } else {
      inlined = underImportConditions(
        inlinedInjectedSheet(text, imported, options, chain),
        rule
      )
    }

    out +=
      rootedAtExtensionFrom(
        css.slice(at, rule.start),
        sheetName,
        options.root
      ) + inlined

    at = rule.end
  }

  return out + rootedAtExtensionFrom(css.slice(at), sheetName, options.root)
}
