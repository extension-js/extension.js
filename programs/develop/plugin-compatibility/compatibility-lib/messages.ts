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
