//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import colors from 'pintor'
import {type Channel, prefix} from '../../lib/messaging'
import type {DevOptions} from '../../types'
import {
  NATIVE_BROWSER_NAMESPACE_CHROMIUM,
  NATIVE_BROWSER_NAMESPACE_CHROMIUM_DEVTOOLS
} from './native-browser-namespace'

function getLoggingPrefix(type: Channel): string {
  return prefix(type)
}

const code = (text: string) => colors.blue(text)

export function webextensionPolyfillNotFound() {
  return (
    `${getLoggingPrefix('warn')} webextension-polyfill isn't installed.\n` +
    `The browser API polyfill is disabled for this build.\n` +
    `Install it with ${code('npm install webextension-polyfill')}.`
  )
}

function browserKey(browser: DevOptions['browser']) {
  return String(browser || 'unknown')
}

// The scan reads the emitted script, where a typeof guard, a chrome fallback
// and a branch the define plugin folded are all left out of the count. What
// is left is a read the scan could not prove safe, not one proven to throw,
// so the sentence says "may" and names the guard that would settle it.
export function browserGlobalWithoutPolyfill(
  browser: DevOptions['browser'],
  files: string[],
  floor: number = NATIVE_BROWSER_NAMESPACE_CHROMIUM
) {
  const subject = files.length === 1 ? files[0] : files.join(', ')
  const target = browserKey(browser)
  const since =
    floor === NATIVE_BROWSER_NAMESPACE_CHROMIUM_DEVTOOLS
      ? `Chromium ${String(floor)} for an extension with a devtools_page`
      : `Chromium ${String(floor)}`

  return (
    `${subject} uses browser.*, which ${target} has natively only from ` +
    `${since}. Older versions get it through the cross-browser polyfill, ` +
    `and this build has the polyfill off. ` +
    `extension dev and extension start turn it on by default while ` +
    `extension build leaves it off, so the dev session works and the ` +
    `packaged build may throw "browser is not defined" if this code runs ` +
    `on ${target} older than ${String(floor)}. Set minimum_chrome_version ` +
    `to "${String(floor)}" in manifest.json if older versions are out of ` +
    `scope, build with --polyfill, set commands.build.polyfill to ` +
    `true in extension.config.js, guard the read with a typeof browser ` +
    `check or a branch on ` +
    `import.meta.env.EXTENSION_PUBLIC_BROWSER, or call chrome.* instead.`
  )
}

export function compatibilityPolyfillEnabled(
  browser: DevOptions['browser'],
  polyfillPath: string
) {
  return (
    `${prefix('debug')} compat   polyfill=enabled browser=${browserKey(browser)} ` +
    `alias=${polyfillPath}`
  )
}

export function compatibilityPolyfillSkipped(
  reason: string,
  browser: DevOptions['browser']
) {
  return (
    `${prefix('debug')} compat   polyfill=skipped ` +
    `browser=${browserKey(browser)} reason="${reason}"`
  )
}

export function compatibilityPolyfillDisabled(browser: DevOptions['browser']) {
  return `${prefix('debug')} compat   polyfill=disabled browser=${browserKey(browser)}`
}
