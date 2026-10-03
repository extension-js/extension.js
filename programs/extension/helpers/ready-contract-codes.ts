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
  compile_error: CODES.E_COMPILE,
  compile_failed: CODES.E_COMPILE_FATAL,
  dev_server_start_failed: CODES.E_DEV_SERVER_START,
  extension_load_refused: CODES.E_EXTENSION_LOAD_REFUSED,
  preview_manifest_missing: CODES.E_PREVIEW_NO_DIST,
  profile_locked: CODES.E_PROFILE_LOCKED,
  shutdown: CODES.E_SESSION_STOPPED
}

export function readyContractErrorCode(code: unknown): ErrorCode | undefined {
  if (typeof code !== 'string') return undefined

  return READY_CONTRACT_CODES[code.trim().toLowerCase()]
}
