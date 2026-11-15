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

export interface BrowserGlobalWarningContext {
  // The command whose flag and config key turn the polyfill back on.
  command?: 'dev' | 'start' | 'build'
  // The major of minimum_chrome_version, when the manifest declares one.
  declaredMinimum?: number
}

// Names the oldest Chromium that can install the extension, since that is
// the browser the missing namespace would be read on.
function reachOf(target: string, floor: number, declaredMinimum?: number) {
  if (declaredMinimum === undefined) {
    return (
      `manifest.json sets no minimum_chrome_version, so a ${target} older ` +
      `than ${String(floor)} can install this extension`
    )
  }

  const last = floor - 1
  const span =
    declaredMinimum === last
      ? `${target} ${String(last)}`
      : `${target} ${String(declaredMinimum)} to ${String(last)}`

  return (
    `manifest.json sets minimum_chrome_version to ` +
    `"${String(declaredMinimum)}", so ${span} can install this extension`
  )
}

// The scan reads the emitted script, where a typeof guard, a chrome fallback
// and a branch the define plugin folded are all left out of the count. What
// is left is a read the scan could not prove safe, not one proven to throw,
// so the sentence says "may" and names the guard that would settle it.
export function browserGlobalWithoutPolyfill(
  browser: DevOptions['browser'],
  files: string[],
  floor: number = NATIVE_BROWSER_NAMESPACE_CHROMIUM,
  context: BrowserGlobalWarningContext = {}
) {
  const subject = files.length === 1 ? files[0] : files.join(', ')
  const target = browserKey(browser)
  const command = context.command || 'build'
  const since =
    floor === NATIVE_BROWSER_NAMESPACE_CHROMIUM_DEVTOOLS
      ? `Chromium ${String(floor)} in an extension that declares a ` +
        `devtools_page. A Chromium below ${String(floor)} leaves browser ` +
        `out of every script of such an extension, the background, the ` +
        `pages and the content scripts as well as the DevTools page`
      : `Chromium ${String(floor)}`

  return (
    `${subject} uses browser.*, which ${target} has natively only from ` +
    `${since}. The cross-browser polyfill is off, the default for every ` +
    `command, and ${reachOf(target, floor, context.declaredMinimum)}, ` +
    `where this code may throw "browser is not defined". ` +
    `Set minimum_chrome_version to "${String(floor)}" in manifest.json if ` +
    `older versions are out of scope, run extension ${command} with ` +
    `--polyfill, set commands.${command}.polyfill to true in ` +
    `extension.config.js, guard the read with a typeof browser ` +
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
