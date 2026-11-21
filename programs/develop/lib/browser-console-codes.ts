// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {CODES, type ErrorCode} from './messaging'

// The codes a dev session prints in a browser console, each as
// `Extension.js <CODE>: <text>` at the start of the line.
export const BROWSER_CONSOLE_CODES: ReadonlySet<string> = new Set([
  CODES.W_RELOAD_NOT_APPLIED,
  CODES.W_CONTENT_SCRIPT_NOT_INJECTED,
  CODES.W_CONTENT_SCRIPT_CLEANUP,
  CODES.W_CONTENT_SCRIPT_MOUNT,
  CODES.W_DEV_SERVER_SOCKET
])

const CODED_LINE = /^Extension\.js ([EW]_[A-Z0-9_]{1,64}): /

// The code a console line opens with, or none. A name the table does not
// list as printed in the browser is text a page wrote, and names no code.
export function browserConsoleCodeOf(
  messageParts: readonly unknown[] | undefined
): ErrorCode | undefined {
  const first = messageParts?.[0]

  if (typeof first !== 'string') return undefined

  const code = CODED_LINE.exec(first)?.[1]

  return code && BROWSER_CONSOLE_CODES.has(code)
    ? (code as ErrorCode)
    : undefined
}
