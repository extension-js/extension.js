//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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

export function parseExtensionsList(raw: string | undefined) {
  if (!raw || String(raw).trim().length === 0) return undefined

  const values = String(raw)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return values.length > 0 ? values : undefined
}
