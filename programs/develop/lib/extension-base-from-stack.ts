// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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

// The bridge answers the base to one place only, the first statement of an
// injected file. A bare read calls nothing a page script could have patched.
export const TAKE_BLOCK_OPEN = `{let ${TAKEN_EXTENSION_BASE}="";try{${TAKEN_EXTENSION_BASE}=${EXTENSION_BASE_GLOBAL}}catch(error){}if(typeof ${TAKEN_EXTENSION_BASE}!=="string")${TAKEN_EXTENSION_BASE}="";`

// Text a later step puts ahead of a file lands behind that read, which
// has to stay the statement the file opens on.
export function prependBehindTakeBlock(text: string, prefix: string): string {
  if (!text.startsWith(TAKE_BLOCK_OPEN)) return `${prefix}${text}`

  return `${TAKE_BLOCK_OPEN}${prefix}${text.slice(TAKE_BLOCK_OPEN.length)}`
}
