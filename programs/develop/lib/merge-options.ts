// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {sanitize} from './sanitize'

/**
 * Stock defaults for `extension dev`. Applied only when neither
 * extension.config.js nor an explicit CLI flag set the option.
 */
export const DEV_COMMAND_DEFAULTS = {
  polyfill: true,
  logFormat: 'pretty' as const,
  logTimestamps: true,
  logColor: true,
  logLevel: 'off' as const,
  // Open the browser unless config or an explicit flag says otherwise.
  noOpen: false
}

/**
 * Stock defaults for `extension build`. Zip and silent stay off unless set.
 */
export const BUILD_COMMAND_DEFAULTS = {
  polyfill: false,
  zip: false,
  zipSource: false,
  silent: false
}

/**
 * Stock defaults for the `extension start` / `extension preview` browser
 * phase. Same logger defaults dev uses.
 */
export const SERVE_COMMAND_DEFAULTS = {
  logFormat: 'pretty' as const,
  logTimestamps: true,
  logColor: true,
  logLevel: 'off' as const
}

/**
 * Stock defaults for the silent production build `extension start` runs
 * before its preview phase. Polyfill defaults on, matching start's
 * historical behavior.
 */
export const START_BUILD_DEFAULTS = {
  polyfill: true,
  silent: true
}

/**
 * Array-valued option keys that concatenate across layers (browser config,
 * then command config, then CLI). Order is preserved and duplicates are
 * dropped, keeping the first occurrence, so repeating a flag in a later
 * layer never doubles it on the browser command line.
 */
export const CONCAT_ARRAY_KEYS = new Set([
  'browserFlags',
  'excludeBrowserFlags'
])

/**
 * Plain-object option keys that deep-merge across layers. Later layers win
 * on key conflict and nested plain objects recurse.
 */
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

/**
 * Layered option merge with one predictable precedence for every command:
 * stock defaults, then browser config, then command config, then CLI.
 *
 * Per-value strategy:
 * - Scalars (and most keys): the last defined layer wins, including `false`.
 * - List keys (`browserFlags`, `excludeBrowserFlags`): concatenate in layer
 *   order and dedupe, so CLI adds to config rather than replacing it.
 * - Object keys (`preferences`): deep-merge, later layers win on conflict.
 *
 * `undefined` values are stripped per layer (via {@link sanitize}) so an
 * unset CLI flag never clobbers extension.config.js, and config never
 * clobbers a flag the user actually typed (including `false`).
 */
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
