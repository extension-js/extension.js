// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {ADDON_LINT_DEFAULT} from './addon-lint'
import {sanitize} from './sanitize'

export const DEV_COMMAND_DEFAULTS = {
  polyfill: true,
  logFormat: 'pretty' as const,
  logTimestamps: true,
  logColor: true,
  logLevel: 'off' as const,
  // Open the browser unless config or an explicit flag says otherwise.
  noOpen: false
}

export const BUILD_COMMAND_DEFAULTS = {
  polyfill: false,
  zip: false,
  zipSource: false,
  silent: false,
  addonLint: ADDON_LINT_DEFAULT
}

export const SERVE_COMMAND_DEFAULTS = {
  logFormat: 'pretty' as const,
  logTimestamps: true,
  logColor: true,
  logLevel: 'off' as const
}

export const START_BUILD_DEFAULTS = {
  polyfill: true,
  silent: true,
  // start previews the build in a browser, it does not ship it, so the
  // store check stays out of that loop unless the config asks for it.
  addonLint: false
}

export const CONCAT_ARRAY_KEYS = new Set([
  'browserFlags',
  'excludeBrowserFlags'
])

export const DEEP_MERGE_OBJECT_KEYS = new Set(['preferences'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  )
}

function deepMergeObjects(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {...base}

  for (const [key, value] of Object.entries(overlay)) {
    if (typeof value === 'undefined') continue

    const existing = result[key]

    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMergeObjects(existing, value)
    } else {
      result[key] = value
    }
  }

  return result
}

function concatUnique(prev: unknown, next: unknown[]): unknown[] {
  const prevArr = Array.isArray(prev) ? prev : []
  const seen = new Set<unknown>()
  const combined: unknown[] = []

  for (const item of [...prevArr, ...next]) {
    if (seen.has(item)) continue

    seen.add(item)
    combined.push(item)
  }

  return combined
}

// Fold one sanitized layer onto the accumulator: concat keys append (deduped),
// deep-merge keys recurse, everything else is last-defined-wins.
function mergeLayer(
  base: Record<string, unknown>,
  layer: object
): Record<string, unknown> {
  const clean = sanitize(layer) as Record<string, unknown>
  const result: Record<string, unknown> = {...base}

  for (const [key, value] of Object.entries(clean)) {
    if (CONCAT_ARRAY_KEYS.has(key) && Array.isArray(value)) {
      result[key] = concatUnique(result[key], value)
      continue
    }

    if (DEEP_MERGE_OBJECT_KEYS.has(key) && isPlainObject(value)) {
      const prev = result[key]
      result[key] = isPlainObject(prev)
        ? deepMergeObjects(prev, value)
        : {...value}

      continue
    }

    result[key] = value
  }

  return result
}

export function mergeOptionLayers<T extends object>(
  defaults: Partial<T>,
  ...layers: Array<object | null | undefined>
): T {
  let result = mergeLayer({}, defaults as object)

  for (const layer of layers) {
    result = mergeLayer(result, (layer || {}) as object)
  }

  return result as T
}
