// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {type Manifest} from '../../../types'

export interface FatalShapeFix {
  field: string
  detail: string
}

/**
 * Repair author-manifest shapes that make Chrome refuse to load the whole
 * extension. Loading via --load-extension surfaces the refusal as a native
 * modal dialog (no CDP, no console), so a dev session just wedges — the
 * browser never binds its debug endpoint. Both shapes below were found in
 * the wild and are unambiguous to fix:
 *
 * - `"version": 1.0` — JSON authors write a number; Chrome requires a string
 *   of 1-4 dot-separated integers. String() preserves the intent.
 * - `"version": "x.y.z"` (any string that is not 1-4 dot-separated integers
 *   0-65535) — a placeholder the author never filled in; Chrome refuses the
 *   whole extension over it. Salvage the numeric parts when there are any,
 *   fall back to "0.0.0" otherwise.
 * - `"default_icon": ""` (in action/browser_action/page_action) — an empty
 *   icon path rejects the extension. Empty means "no icon": drop the key.
 */
export function sanitizeFatalManifestShapes(manifest: Manifest): {
  manifest: Manifest
  fixes: FatalShapeFix[]
} {
  const out = manifest as Record<string, any>
  const fixes: FatalShapeFix[] = []

  if (out.version != null && typeof out.version !== 'string') {
    const from = JSON.stringify(out.version)
    out.version = String(out.version)
    fixes.push({
      field: 'version',
      detail: `coerced ${from} (${typeof JSON.parse(from)}) to the string "${out.version}" — Chrome rejects a non-string version`
    })
  }

  if (
    typeof out.version === 'string' &&
    !isValidChromeVersion(out.version.trim())
  ) {
    const from = out.version
    out.version = salvageVersion(out.version)
    fixes.push({
      field: 'version',
      detail: `replaced "${from}" with "${out.version}" — Chrome requires 1-4 dot-separated integers (0-65535) and refuses the whole extension otherwise`
    })
  }

  for (const actionKey of ['action', 'browser_action', 'page_action']) {
    const action = out[actionKey]
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      continue
    }
    const icon = action.default_icon
    const isEmptyString = icon === ''
    const isEmptyObject =
      icon !== null &&
      typeof icon === 'object' &&
      !Array.isArray(icon) &&
      Object.keys(icon).length === 0
    if (isEmptyString || isEmptyObject) {
      delete action.default_icon
      fixes.push({
        field: `${actionKey}.default_icon`,
        detail:
          'removed the empty default_icon — Chrome rejects the whole extension over it'
      })
    }
  }

  return {manifest: out as Manifest, fixes}
}

/** Chrome's manifest version grammar: 1-4 dot-separated integers 0-65535. */
function isValidChromeVersion(version: string): boolean {
  if (!version) return false
  const parts = version.split('.')
  if (parts.length > 4) return false
  return parts.every((part) => /^\d{1,5}$/.test(part) && Number(part) <= 65535)
}

/**
 * Salvage what numbers the author DID write ("1.0-beta" -> "1.0",
 * "v2.3" -> "2.3"); a version with none ("x.y.z") becomes "0.0.0".
 */
function salvageVersion(version: string): string {
  const digits = version.match(/\d{1,5}/g)?.slice(0, 4) ?? []
  if (!digits.length) return '0.0.0'
  return digits.map((digit) => String(Math.min(Number(digit), 65535))).join('.')
}
