//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {isValidBundleId} from '../browsers/run-safari/safari-launch/safari-config'
import {LOG_CONTEXTS, type LogContext} from './log-contexts'

// Unknown names are dropped rather than refused, as this flag always did.
export function parseLogContexts(
  raw: string | undefined
): LogContext[] | undefined {
  if (!raw || String(raw).trim().length === 0) return undefined
  if (String(raw).trim().toLowerCase() === 'all') return undefined

  const values = String(raw)
    .split(',')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0)
    .filter((c: string): c is LogContext =>
      (LOG_CONTEXTS as readonly string[]).includes(c)
    )

  return values.length > 0 ? values : undefined
}

export type PositiveIntParse =
  | {ok: true; value: number | undefined}
  | {ok: false; message: string}

// A flag that reaches the bridge as a number. NaN would serialize to null and
// read downstream as "unset", so anything but a whole positive number refuses.
export function parsePositiveInt(flag: string, raw: unknown): PositiveIntParse {
  if (raw == null) return {ok: true, value: undefined}

  const text = String(raw).trim()

  if (text.length === 0) return {ok: true, value: undefined}

  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN

  if (!Number.isSafeInteger(value) || value < 1) {
    return {
      ok: false,
      message: `${flag} expects a positive integer, got: ${text}`
    }
  }

  return {ok: true, value}
}

// Digits only: parseInt read `10s` as 10 and `1e3` as 1, so a typo ran with
// another number instead of being refused.
export function parseWholeNumber(raw: unknown): number | undefined {
  const text = String(raw ?? '').trim()
  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN

  return Number.isSafeInteger(value) ? value : undefined
}

export type WholeNumberFlag = '--wait-timeout' | '--parent-pid' | '--port'

// The smallest and largest value each flag takes. --port 0 asks for a free port.
const WHOLE_NUMBER_BOUNDS: Record<WholeNumberFlag, [number, number]> = {
  '--wait-timeout': [1, Number.MAX_SAFE_INTEGER],
  '--parent-pid': [1, Number.MAX_SAFE_INTEGER],
  '--port': [0, 65535]
}

export function isValidWholeNumberFlag(
  flag: WholeNumberFlag,
  raw: unknown
): boolean {
  const value = parseWholeNumber(raw)
  const [min, max] = WHOLE_NUMBER_BOUNDS[flag]

  return value !== undefined && value >= min && value <= max
}

// The first typed flag whose value is refused, in the order given.
export function firstInvalidWholeNumberFlag(
  values: Array<[WholeNumberFlag, unknown]>
): [WholeNumberFlag, string] | undefined {
  for (const [flag, raw] of values) {
    if (raw === undefined) continue
    if (!isValidWholeNumberFlag(flag, raw)) return [flag, String(raw)]
  }

  return undefined
}

// Apple takes a single label, but the identity of a shipped app needs an owner
// domain in front of it, which is what the help asks for.
export function isReverseDnsBundleId(value: string): boolean {
  return value.includes('.') && isValidBundleId(value)
}

export function parseExtensionsList(raw: string | undefined) {
  if (!raw || String(raw).trim().length === 0) return undefined

  const values = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return values.length > 0 ? values : undefined
}
