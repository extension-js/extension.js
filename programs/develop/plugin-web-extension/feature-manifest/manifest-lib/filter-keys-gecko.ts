// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {humanLine} from '../../../dev-server/lifecycle-stream'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import type {DevOptions, Manifest} from '../../../types'
import * as messages from '../messages'

// Permission strings a live Firefox rejects from both permission lists.
// userScripts stays out: Firefox takes it as an optional permission.
export const GECKO_UNSUPPORTED_PERMISSIONS: ReadonlySet<string> =
  new Set<string>([
    'accessibilityFeatures.modify',
    'accessibilityFeatures.read',
    'audio',
    'background',
    'certificateProvider',
    'contentSettings',
    'debugger',
    'declarativeContent',
    'desktopCapture',
    'documentScan',
    'downloads.ui',
    'enterprise.deviceAttributes',
    'enterprise.platformKeys',
    'experimental',
    'favicon',
    'fileBrowserHandler',
    'fileSystemProvider',
    'fontSettings',
    'gcm',
    'identity.email',
    'loginState',
    'offscreen',
    'pageCapture',
    'platformKeys',
    'power',
    'printerProvider',
    'printing',
    'printingMetrics',
    'processes',
    'readingList',
    'sidePanel',
    'system.cpu',
    'system.display',
    'system.memory',
    'system.storage',
    'systemLog',
    'tabCapture',
    'tts',
    'ttsEngine',
    'vpnProvider',
    'wallpaper',
    'webAuthenticationProxy'
  ])

export interface GeckoDroppedKey {
  // Dotted location of what was dropped, like permissions.sidePanel
  path: string
  reason: string
}

export interface GeckoReinterpretedKey {
  path: string
  declared: string
  // The value Firefox runs the extension with
  effective: string
}

const PERMISSION_LISTS = ['permissions', 'optional_permissions'] as const

// A string Firefox ignores is dropped. A value Firefox reads as another one
// still decides how the extension runs, so it stays and is only named.
export function dropGeckoUnsupportedKeys(
  manifest: Manifest,
  browser: DevOptions['browser']
): {
  manifest: Manifest
  dropped: GeckoDroppedKey[]
  reinterpreted: GeckoReinterpretedKey[]
} {
  const dropped: GeckoDroppedKey[] = []
  const reinterpreted: GeckoReinterpretedKey[] = []

  if (!isGeckoBasedBrowser(String(browser))) {
    return {manifest, dropped, reinterpreted}
  }

  const next: Record<string, unknown> = {...(manifest as object)}

  for (const listName of PERMISSION_LISTS) {
    const list = next[listName]
    if (!Array.isArray(list)) continue

    const kept = list.filter((entry) => {
      if (
        typeof entry !== 'string' ||
        !GECKO_UNSUPPORTED_PERMISSIONS.has(entry)
      ) {
        return true
      }

      dropped.push({
        path: `${listName}.${entry}`,
        reason: `Firefox has no ${entry} permission`
      })

      return false
    })

    if (kept.length === list.length) continue
    if (kept.length === 0) delete next[listName]
    else next[listName] = kept
  }

  // Firefox has no split mode and loads the extension as not_allowed.
  if (next.incognito === 'split') {
    reinterpreted.push({
      path: 'incognito',
      declared: 'split',
      effective: 'not_allowed'
    })
  }

  return {manifest: next as Manifest, dropped, reinterpreted}
}

// Dev rebuilds the same manifest on every save, so one notice per distinct
// finding for the life of the process is enough.
const reported = new Set<string>()

export function reportGeckoUnsupportedKeys(
  found: {dropped: GeckoDroppedKey[]; reinterpreted: GeckoReinterpretedKey[]},
  browser: DevOptions['browser']
): void {
  const target = String(browser)

  if (found.dropped.length > 0) {
    const signature = `${target}\0${found.dropped
      .map((entry) => entry.path)
      .join(',')}`

    if (!reported.has(signature)) {
      reported.add(signature)
      humanLine(messages.geckoUnsupportedKeysDropped(target, found.dropped))
    }
  }

  for (const entry of found.reinterpreted) {
    const signature = `${target}\0${entry.path}=${entry.declared}`
    if (reported.has(signature)) continue

    reported.add(signature)
    humanLine(messages.geckoIncognitoSplitNotAllowed(target))
  }
}

// Tests drive the reporter repeatedly, so they need the dedupe cleared.
export function resetGeckoKeyNotices(): void {
  reported.clear()
}
