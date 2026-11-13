// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {
  EXTENSION_ROOT_PLACEHOLDER,
  toRuntimeStylesheetModule
} from '../../../plugin-css/css-lib/inline-content-script-css'
import {replaceCssUrlRefs} from '../../../plugin-css/css-lib/dead-url-refs'
import {
  dropSourceMapComment,
  sfcStyleBlockId
} from '../../../plugin-css/css-lib/sfc-style-block'
import {createContentScriptCssProbeMarkerPattern} from '../contracts'

// A step that runs again on a file it already wrote finds the sheet between
// these two and replaces it, so a rebuild never stacks a second copy.
export const SHEET_BLOCK_OPEN = '/*extjs-sheet*/(function(module){'
export const SHEET_BLOCK_CLOSE = '})({});/*extjs-sheet-end*/'

export function runtimeScriptSheetName(entryName: string): string {
  return `${entryName}.css`
}

// An emitted sheet names its url() targets from the output root, which a
// sheet placed on the visited page would read as that page's own root.
export function rootedSheet(css: string): string {
  return replaceCssUrlRefs(dropSourceMapComment(css), (request) =>
    request.startsWith('/') && !request.startsWith('//')
      ? `${EXTENSION_ROOT_PLACEHOLDER}${request.slice(1)}`
      : undefined
  )
}

// One line, so the file's source map keeps every line it already mapped.
export function runtimeScriptSheetBlock(input: {
  css: string
  entryName: string
  devSalt: string
  gecko: boolean
  baseAttribute?: string
  baseScheme?: string
}): string {
  const {css, entryName, devSalt, gecko} = input
  const body = toRuntimeStylesheetModule(
    rootedSheet(css),
    [],
    sfcStyleBlockId(runtimeScriptSheetName(entryName), '', devSalt),
    gecko,
    input.baseAttribute,
    input.baseScheme
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')

  return `${SHEET_BLOCK_OPEN}${body}${SHEET_BLOCK_CLOSE}`
}

export function withoutSheetBlock(text: string): string {
  const from = text.indexOf(SHEET_BLOCK_OPEN)
  if (from === -1) return text

  const to = text.indexOf(SHEET_BLOCK_CLOSE, from)
  if (to === -1) return text

  return `${text.slice(0, from)}${text.slice(to + SHEET_BLOCK_CLOSE.length)}`
}

// The wrapper leaves a marker that spells the sheet's name in every bundle
// it wraps, which is the build asking for the file and not the author.
export function namesSheet(scriptText: string, sheetName: string): boolean {
  return scriptText
    .replace(createContentScriptCssProbeMarkerPattern(), '')
    .includes(sheetName)
}
