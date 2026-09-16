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

/**
 * Safari inherits `chromium:` manifest keys by design, which is what makes one
 * manifest serve every browser. The cost is that a Safari build used to ship
 * config Safari has no code for: a `side_panel` whose toolbar button opens
 * nothing, a `sandbox` page that cannot run, permissions Safari refuses.
 *
 * The lists below are derived from `xcrun safari-web-extension-converter`
 * (Xcode 26.6, macOS 26.5.2) run against probe extensions that declare each
 * candidate key, then reconciled against MDN browser-compat-data. Only keys
 * BOTH sources call unsupported, or that MDN records as inert on Safari, are
 * dropped here. The converter alone over-reports: its table still flags keys
 * Safari has supported for years.
 */

export interface WebkitDroppedKey {
  // Dotted location of what was dropped, like permissions.sidePanel
  path: string
  // Short why, rendered beside the path in the build warning
  reason: string
}

// Top-level keys the converter rejects and MDN confirms Safari does not
// implement, plus `incognito`, which Safari parses but always overrides.
const UNSUPPORTED_TOP_LEVEL_KEYS: Record<string, string> = {
  side_panel: 'Safari has no side panel surface',
  sandbox: 'Safari cannot run sandboxed extension pages',
  user_scripts: 'Safari has no userScripts API',
  omnibox: 'Safari has no omnibox keyword API',
  chrome_settings_overrides: 'Safari lets no extension override these settings',
  tts_engine: 'Safari has no speech engine API',
  file_browser_handlers: 'ChromeOS only',
  input_components: 'ChromeOS only',
  cross_origin_embedder_policy: 'Safari reads no COEP key from a manifest',
  cross_origin_opener_policy: 'Safari reads no COOP key from a manifest',
  requirements: 'Chrome Web Store only',
  oauth2: 'Safari has no identity API to consume it',
  nacl_modules: 'Native Client is Chrome only',
  replacement_web_app: 'Chrome Web Store only',
  offline_enabled: 'Chrome Web Store only',
  differential_fingerprint: 'Chrome Web Store only',
  incognito:
    'Safari always runs extensions in spanning mode and ignores the declared value'
}

// Permission strings the converter rejects. Every one of them also reads as
// unsupported or absent in MDN browser-compat-data, so none is a false drop.
const UNSUPPORTED_PERMISSIONS = new Set<string>([
  'accessibilityFeatures.modify',
  'accessibilityFeatures.read',
  'audio',
  'background',
  'bookmarks',
  'browsingData',
  'certificateProvider',
  'clipboardRead',
  'contentSettings',
  'debugger',
  'declarativeContent',
  'desktopCapture',
  'documentScan',
  'downloads',
  'enterprise.deviceAttributes',
  'enterprise.platformKeys',
  'experimental',
  'favicon',
  'fileSystemProvider',
  'fontSettings',
  'gcm',
  'geolocation',
  'history',
  'identity',
  'identity.email',
  'idle',
  'management',
  'notifications',
  'offscreen',
  'pageCapture',
  'platformKeys',
  'power',
  'printerProvider',
  'privacy',
  'processes',
  'proxy',
  'readingList',
  'search',
  'sessions',
  'sidePanel',
  'system.cpu',
  'system.display',
  'system.memory',
  'system.storage',
  'systemLog',
  'tabCapture',
  'tabGroups',
  'topSites',
  'tts',
  'ttsEngine',
  'userScripts',
  'vpnProvider',
  'wallpaper',
  'webAuthenticationProxy',
  'webRequestBlocking'
])

// Both arrays carry the same permission strings, so both get filtered.
const PERMISSION_LISTS = ['permissions', 'optional_permissions'] as const

/**
 * DELIBERATELY NOT DROPPED: `content_scripts[].world`.
 *
 * The converter rejects `world`, but MDN records Safari as supporting it from
 * Safari 18 and this machine runs Safari 26.5.2. Dropping it would silently
 * demote a MAIN world content script to ISOLATED on a Safari that can honor
 * it, which is a worse failure than the warning. The converter's table is the
 * stale side here: it also still flags `options_ui.open_in_tab`, which Safari
 * has accepted since Safari 14. Flip this to true only if a live Safari is
 * shown to ignore the key.
 */
const DROP_CONTENT_SCRIPT_WORLD = false

// Nested properties that are inert on Safari. `open_in_tab` is accepted but
// ignored, since Safari always opens an options page in its own tab.
const UNSUPPORTED_OPTIONS_UI_KEYS: Record<string, string> = {
  open_in_tab: 'Safari always opens the options page in a tab'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Strip every manifest key and permission Safari has no code for. Runs on the
 * canonical manifest, after `chromium:` prefixes resolved and the overrides
 * had their say, so an override cannot reintroduce a dropped key.
 *
 * Non-webkit targets are returned untouched.
 */
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

  if (DROP_CONTENT_SCRIPT_WORLD && Array.isArray(next.content_scripts)) {
    next.content_scripts = next.content_scripts.map(
      (entry: unknown, index: number) => {
        if (!isPlainObject(entry) || !('world' in entry)) return entry
        const {world: _world, ...rest} = entry
        // The entry survives without its world, so the script still injects.
        dropped.push({
          path: `content_scripts[${String(index)}].world`,
          reason: 'Safari injects every content script into the isolated world'
        })
        return rest
      }
    )
  }

  return {manifest: next as Manifest, dropped}
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
