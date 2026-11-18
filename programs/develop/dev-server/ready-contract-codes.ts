// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {CODES, type ErrorCode} from '../lib/messaging'

// ready.json names a failed session with an id of its own. --wait reads a
// copy of this table, and a contract spec keeps the two equal.
export const READY_CONTRACT_CODES: Readonly<Record<string, ErrorCode>> = {
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

  const key = code.trim().toLowerCase()

  return Object.prototype.hasOwnProperty.call(READY_CONTRACT_CODES, key)
    ? READY_CONTRACT_CODES[key]
    : undefined
}

// A launch refused over a value the user set: no compile changes it, so the
// dev session ends on usage, as every other command reports it.
const USAGE_LAUNCH_CODES: ReadonlySet<string> = new Set([
  CODES.E_BROWSER_BINARY_INVALID,
  CODES.E_BROWSER_BINARY_REQUIRED,
  CODES.E_FLAG_NOT_SUPPORTED_HERE
])

export function isUsageLaunchCode(code: unknown): boolean {
  return typeof code === 'string' && USAGE_LAUNCH_CODES.has(code)
}
