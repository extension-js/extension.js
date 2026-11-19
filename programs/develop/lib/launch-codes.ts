// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {CODES} from './messaging'

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
