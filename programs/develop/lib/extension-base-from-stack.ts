// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'

export const EXTENSION_BASE_FROM_STACK =
  '(function(){try{var m=String(new Error().stack||"").match(/[a-z-]+-extension:\\/\\/[^\\/\\s)]+\\//);return m?m[0]:""}catch(_){return ""}})()'

export const EXTENSION_BASE_GLOBAL = '__EXTJS_EXTENSION_BASE__'
export const TAKEN_EXTENSION_BASE = '__extjsTakenBase'

// A Gecko MAIN world file opens on the statement that takes the base, so
// every reader in it starts from that copy and never asks the page again.
export function extensionBaseFromFile(gecko: boolean): string {
  if (!gecko) return EXTENSION_BASE_FROM_STACK

  return `((typeof ${TAKEN_EXTENSION_BASE} === "string" && ${TAKEN_EXTENSION_BASE}) || ${EXTENSION_BASE_FROM_STACK})`
}

// A page script can patch replace and charAt and read the string they are
// called on, so a Gecko reader closes the base on its slash by index.
export function closedOnSlash(name: string): string {
  return `(${name}[${name}.length - 1] === "/" ? ${name} : ${name} + "/")`
}

// A page can write the document's copy of the base, so a Gecko reader
// drops a value that is no extension address before it builds a URL on it.
export function unlessExtensionAddress(name: string): string {
  return `if (typeof ${name} !== "string" || ${name} < "moz-extension://" || ${name} >= "moz-extension:/0") ${name} = "";`
}

const KEYED_GLOBAL = /^__EXTJS_EXTENSION_BASE_(?:[0-9a-f]{8}_)?_/
const TAKE_BLOCK_READ = `{let ${TAKEN_EXTENSION_BASE}="";try{${TAKEN_EXTENSION_BASE}=`
// A page can hold the name first, so a value that is no extension address
// reads as nothing. Comparing strings calls nothing a page could patch.
const TAKE_BLOCK_CHECK = `}catch(error){}if(typeof ${TAKEN_EXTENSION_BASE}!=="string"||${TAKEN_EXTENSION_BASE}<"moz-extension://"||${TAKEN_EXTENSION_BASE}>="moz-extension:/0")${TAKEN_EXTENSION_BASE}="";`

// Two extensions on one page each publish a base, so each one names its
// own global. The name is told apart, not hidden, and holds for every build.
export function extensionBaseGlobal(identity: string): string {
  const digest = createHash('sha256').update(identity).digest('hex')

  return `${EXTENSION_BASE_GLOBAL.slice(0, -1)}${digest.slice(0, 8)}__`
}

// The bridge answers the base to one place only, the first statement of an
// injected file. A bare read calls nothing a page script could have patched.
export function takeBlockOpen(global: string = EXTENSION_BASE_GLOBAL): string {
  return `${TAKE_BLOCK_READ}${global}${TAKE_BLOCK_CHECK}`
}

export const TAKE_BLOCK_OPEN = takeBlockOpen()

// The read a file opens on, whichever extension's global it names.
export function readTakeBlock(text: string): string | null {
  if (!text.startsWith(TAKE_BLOCK_READ)) return null

  const global = KEYED_GLOBAL.exec(
    text.slice(TAKE_BLOCK_READ.length, TAKE_BLOCK_READ.length + 64)
  )
  if (!global) return null

  const open = takeBlockOpen(global[0])

  return text.startsWith(open) ? open : null
}

// Text a later step puts ahead of a file lands behind that read, which
// has to stay the statement the file opens on.
export function prependBehindTakeBlock(text: string, prefix: string): string {
  const open = readTakeBlock(text)
  if (!open) return `${prefix}${text}`

  return `${open}${prefix}${text.slice(open.length)}`
}
