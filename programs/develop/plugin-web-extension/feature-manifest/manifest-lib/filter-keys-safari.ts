// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {humanLine} from '../../../dev-server/lifecycle-stream'
import {isWebkitBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'
import * as messages from '../messages'
import {
  WEBKIT_UNSUPPORTED_OPTIONS_UI_KEYS as UNSUPPORTED_OPTIONS_UI_KEYS,
  WEBKIT_UNSUPPORTED_PERMISSIONS as UNSUPPORTED_PERMISSIONS,
  WEBKIT_UNSUPPORTED_TOP_LEVEL_KEYS as UNSUPPORTED_TOP_LEVEL_KEYS
} from './webkit-unsupported-keys'

export {
  WEBKIT_UNSUPPORTED_PERMISSIONS as UNSUPPORTED_PERMISSIONS,
  type WebkitDroppedPage,
  type WebkitUnsupportedKey,
  webkitDroppedSurfacePages,
  webkitUnsupportedManifestKeys,
  webkitUnsupportedPermissions
} from './webkit-unsupported-keys'

export interface WebkitDroppedKey {
  // Dotted location of what was dropped, like permissions.sidePanel
  path: string
  // Short why, rendered beside the path in the build warning
  reason: string
}

// Both arrays carry the same permission strings, so both get filtered.
const PERMISSION_LISTS = ['permissions', 'optional_permissions'] as const

// Later stages write the manifest again, so they ask here before listing a
// permission this one already dropped.
export function isWebkitUnsupportedPermission(
  permission: string,
  browser?: string
): boolean {
  return (
    isWebkitBasedBrowser(String(browser)) &&
    UNSUPPORTED_PERMISSIONS.has(permission)
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function dropWebkitUnsupportedKeys(
  manifest: Manifest,
  browser: DevOptions['browser']
): {manifest: Manifest; dropped: WebkitDroppedKey[]} {
  const dropped: WebkitDroppedKey[] = []
  if (!isWebkitBasedBrowser(String(browser))) return {manifest, dropped}

  const next: Record<string, unknown> = {...(manifest as object)}

  for (const [key, reason] of Object.entries(UNSUPPORTED_TOP_LEVEL_KEYS)) {
    if (!(key in next)) continue

    delete next[key]
    dropped.push({path: key, reason})
  }

  for (const listName of PERMISSION_LISTS) {
    const list = next[listName]
    if (!Array.isArray(list)) continue

    const kept = list.filter((entry) => {
      if (typeof entry !== 'string' || !UNSUPPORTED_PERMISSIONS.has(entry)) {
        return true
      }

      dropped.push({
        path: `${listName}.${entry}`,
        reason: `Safari has no ${entry} API`
      })

      return false
    })

    // An emptied list means the extension asked for nothing Safari has, so the
    // key goes too rather than shipping an empty array.
    if (kept.length === list.length) continue
    if (kept.length === 0) delete next[listName]
    else next[listName] = kept
  }

  const optionsUi = next.options_ui

  if (isPlainObject(optionsUi)) {
    const patched = {...optionsUi}
    let changed = false

    for (const [key, reason] of Object.entries(UNSUPPORTED_OPTIONS_UI_KEYS)) {
      if (!(key in patched)) continue

      delete patched[key]
      changed = true
      dropped.push({path: `options_ui.${key}`, reason})
    }

    // The options page itself works on Safari, so only the inert flag goes.
    if (changed) next.options_ui = patched
  }

  // content_scripts[].world is deliberately not dropped. Apple's converter
  // still warns about it, but MDN browser-compat-data records version_added
  // 18 for safari (and 128 for firefox), so a drop would silently demote a
  // MAIN world script on a Safari that honors it. The browsers-lib converter
  // warning names the same decision, keep the two agreed.

  return {manifest: next as Manifest, dropped}
}

// Entry slots are named after the top-level key that owns them, so a dropped
// key takes the pages, scripts and icons only it referenced out of the build.
export function omitWebkitDroppedEntries<T extends Record<string, unknown>>(
  entries: T,
  dropped: WebkitDroppedKey[]
): T {
  const owners = new Set(dropped.map((entry) => entry.path))
  if (owners.size === 0) return entries

  return Object.fromEntries(
    Object.entries(entries).filter(
      ([feature]) => !owners.has(feature.split('/')[0])
    )
  ) as T
}

// Dev recompiles rebuild the same manifest on every save. One human line per
// distinct set of drops for the life of the process is enough, and a restarted
// session prints again.
const reportedDrops = new Set<string>()

export function reportWebkitDroppedKeys(
  dropped: WebkitDroppedKey[],
  browser: DevOptions['browser']
): void {
  if (dropped.length === 0) return

  const signature = `${String(browser)}\0${dropped
    .map((entry) => entry.path)
    .join(',')}`
  if (reportedDrops.has(signature)) return

  reportedDrops.add(signature)

  humanLine(messages.webkitUnsupportedKeysDropped(String(browser), dropped))
}

// Tests drive the reporter repeatedly, so they need the dedupe cleared.
export function resetWebkitDropNotices(): void {
  reportedDrops.clear()
}
