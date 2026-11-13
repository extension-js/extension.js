// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {
  EXTENSION_BASE_GLOBAL,
  extensionBaseGlobal,
  readTakeBlock,
  takeBlockOpen
} from '../../../lib/extension-base-from-stack'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {stripBom} from '../../../lib/parse-json-safe'
import type {DevOptions, Manifest} from '../../../types'

const TAKE_BLOCK_CLOSE = '\n}'

// The bridge trusts a read from these columns of line one, which this text
// fills, so no other statement of the file can sit there.
export const TAKE_BLOCK_COLUMNS = takeBlockOpen(extensionBaseGlobal('')).length

const globals = new Map<string, string>()

// The page global one extension's bridge and MAIN world files share. It is
// read once per session, so every file of a session names the same one.
export function extensionBaseGlobalFor(
  manifestPath: string,
  browser: DevOptions['browser'] = 'firefox'
): string {
  const key = `${manifestPath}::${String(browser)}`
  const known = globals.get(key)
  if (known) return known

  let global = EXTENSION_BASE_GLOBAL

  try {
    const manifest = filterKeysForThisBrowser(
      JSON.parse(stripBom(fs.readFileSync(manifestPath, 'utf8'))) as Manifest,
      browser
    ) as {
      name?: unknown
      description?: unknown
      browser_specific_settings?: {gecko?: {id?: unknown}}
    }

    global = extensionBaseGlobal(
      [
        manifest.browser_specific_settings?.gecko?.id,
        manifest.name,
        manifest.description
      ]
        .map((part) => (typeof part === 'string' ? part : ''))
        .join('\n')
    )
  } catch {
    // A manifest nobody can read is the build's own error to report.
  }

  globals.set(key, global)

  return global
}

export function takesExtensionBase(text: string): boolean {
  return readTakeBlock(text) !== null
}

// The emitted file closes its block ahead of the source map comment.
export function closeTakeBlock(
  text: string,
  global: string = EXTENSION_BASE_GLOBAL
): {open: string; closed: string} {
  const trailer = /\n\/\/# sourceMappingURL=[^\n]*\s*$/.exec(text)
  const body = trailer ? text.slice(0, trailer.index) : text

  return {
    open: takeBlockOpen(global),
    closed: `${body}${TAKE_BLOCK_CLOSE}${trailer ? trailer[0] : ''}`
  }
}

// A dev build hashes a content bundle's name, a production build does not.
export function isEntryFile(assetName: string, entryName: string): boolean {
  if (!assetName.startsWith(`${entryName}.`) || !assetName.endsWith('.js')) {
    return false
  }

  const middle = assetName.slice(entryName.length + 1, -'js'.length)

  return middle === '' || /^[0-9a-f]{8}\.$/.test(middle)
}
