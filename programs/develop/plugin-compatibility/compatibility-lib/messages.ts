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

export function browserGlobalWithoutPolyfill(
  browser: DevOptions['browser'],
  files: string[]
) {
  const subject = files.length === 1 ? files[0] : files.join(', ')

  return (
    `${subject} uses browser.*, which ${browserKey(browser)} only has through ` +
    `the cross-browser polyfill, and this build has the polyfill off. ` +
    `extension dev and extension start turn it on by default while ` +
    `extension build leaves it off, so the dev session works and the ` +
    `packaged build throws "browser is not defined". Build with ` +
    `--polyfill, set commands.build.polyfill to true in extension.config.js, ` +
    `or call chrome.* instead.`
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
