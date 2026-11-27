//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {CODES, type ErrorCode} from './messaging'

// ready.json predates the envelope and names a failed session with an id of
// its own, so a reader of the contract has to resolve that id to a real code.
export const READY_CONTRACT_CODES: Record<string, ErrorCode> = {
  browser_exited: CODES.E_BROWSER_EXITED,
  browser_launch_failed: CODES.E_BROWSER_LAUNCH,
  build_failed: CODES.E_COMPILE,
  compile_error: CODES.E_COMPILE,
  compile_failed: CODES.E_COMPILE_FATAL,
  dev_server_start_failed: CODES.E_DEV_SERVER_START,
  extension_load_refused: CODES.E_EXTENSION_LOAD_REFUSED,
  preview_failed: CODES.E_INTERNAL,
  preview_manifest_missing: CODES.E_PREVIEW_NO_DIST,
  profile_locked: CODES.E_PROFILE_LOCKED,
  shutdown: CODES.E_SESSION_STOPPED
}

// Every event name events.ndjson can carry. The engine owns the list as a
// type, and a contract spec holds this copy to it.
export const READY_EVENT_TYPES = [
  'compile_start',
  'compile_success',
  'compile_error',
  'browser_exited',
  'browser_launch_failed',
  'restart_failed',
  'warning',
  'shutdown'
] as const

export function readyContractErrorCode(code: unknown): ErrorCode | undefined {
  if (typeof code !== 'string') return undefined

  const key = code.trim().toLowerCase()

  // A name every object inherits, such as constructor, is not a code.
  return Object.prototype.hasOwnProperty.call(READY_CONTRACT_CODES, key)
    ? READY_CONTRACT_CODES[key]
    : undefined
}

// The launcher stamps the code it refused with beside the generic id, and a
// code the table declares outranks the id's own family code.
export function stampedLaunchFailureCode(ready: {
  code?: unknown
  browserLaunchFailedCode?: unknown
}): ErrorCode | undefined {
  if (ready.code !== 'browser_launch_failed') return undefined

  const code = ready.browserLaunchFailedCode

  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(CODES, code)
    ? (code as ErrorCode)
    : undefined
}

// A session that ended as failed names the code that ended it beside the
// contract's own id. That code is the answer, whatever the id says.
export function stampedEndCode(ready: {
  endedAsFailedCode?: unknown
}): ErrorCode | undefined {
  const code = ready.endedAsFailedCode

  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(CODES, code)
    ? (code as ErrorCode)
    : undefined
}

// What a refused load recorded, as one clause: the browser's own reason and,
// where the launcher knew it, the cause the manifest shows.
export function recordedLoadRefusal(
  contract:
    | {
        extensionLoadRefusedReason?: unknown
        extensionLoadRefusedCause?: unknown
      }
    | null
    | undefined
): string {
  const clause = (value: unknown) =>
    typeof value === 'string' ? value.trim().replace(/[.\s]+$/, '') : ''

  return [
    clause(contract?.extensionLoadRefusedReason),
    clause(contract?.extensionLoadRefusedCause)
  ]
    .filter(Boolean)
    .join('. ')
}
