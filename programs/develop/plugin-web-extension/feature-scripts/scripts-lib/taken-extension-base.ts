// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {TAKE_BLOCK_OPEN} from '../../../lib/extension-base-from-stack'

const TAKE_BLOCK_CLOSE = '\n}'

// The bridge trusts a read from these columns of line one, which this text
// fills, so no other statement of the file can sit there.
export const TAKE_BLOCK_COLUMNS = TAKE_BLOCK_OPEN.length

export function takesExtensionBase(text: string): boolean {
  return text.startsWith(TAKE_BLOCK_OPEN)
}

// The emitted file closes its block ahead of the source map comment.
export function closeTakeBlock(text: string): {open: string; closed: string} {
  const trailer = /\n\/\/# sourceMappingURL=[^\n]*\s*$/.exec(text)
  const body = trailer ? text.slice(0, trailer.index) : text

  return {
    open: TAKE_BLOCK_OPEN,
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
