//  ██████╗ ██████╗ ███╗   ███╗██████╗  █████╗ ████████╗██╗██████╗ ██╗██╗     ██╗████████╗██╗   ██╗
// ██╔════╝██╔═══██╗████╗ ████║██╔══██╗██╔══██╗╚══██╔══╝██║██╔══██╗██║██║     ██║╚══██╔══╝╚██╗ ██╔╝
// ██║     ██║   ██║██╔████╔██║██████╔╝███████║   ██║   ██║██████╔╝██║██║     ██║   ██║    ╚████╔╝
// ██║     ██║   ██║██║╚██╔╝██║██╔═══╝ ██╔══██║   ██║   ██║██╔══██╗██║██║     ██║   ██║     ╚██╔╝
// ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║     ██║  ██║   ██║   ██║██████╔╝██║███████╗██║   ██║      ██║
//  ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝╚═════╝ ╚═╝╚══════╝╚═╝   ╚═╝      ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import colors from 'pintor'
import type {DevOptions} from '../../webpack-types'

function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success') {
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

  if (isAuthor) {
    const base = type === 'error' ? 'ERROR Author says' : '►►► Author says'
    return colors.brightMagenta(base)
  }

  if (type === 'error') return colors.red('ERROR')
  if (type === 'warn') return colors.brightYellow('►►►')
  if (type === 'info') return colors.gray('►►►')
  return colors.green('►►►')
}

const code = (text: string) => colors.blue(text)

export function webextensionPolyfillNotFound() {
  return (
    `${getLoggingPrefix('warn')} webextension-polyfill not found.\n` +
    `Install it to enable the browser API polyfill:\n` +
    `${code('npm install webextension-polyfill')}`
  )
}

function capitalizedBrowserName(browser: DevOptions['browser']) {
  const b = String(browser || '')
  const cap = b.charAt(0).toUpperCase() + b.slice(1)
  return colors.yellow(`${cap}`)
}

export function compatibilityPolyfillEnabled(
  browser: DevOptions['browser'],
  polyfillPath: string
) {
  return (
    `${colors.gray('►►►')} Compatibility: Polyfill enabled for ${capitalizedBrowserName(browser)}\n` +
    `${colors.gray('ALIAS')} ${colors.underline(polyfillPath)}`
  )
}

export function compatibilityPolyfillSkipped(
  reason: string,
  browser: DevOptions['browser']
) {
  return `${colors.gray('►►►')} Compatibility: Polyfill ${colors.gray('skipped')} for ${capitalizedBrowserName(browser)} (${colors.gray(reason)})`
}

export function compatibilityPolyfillDisabled(browser: DevOptions['browser']) {
  return `${colors.gray('►►►')} Compatibility: Polyfill ${colors.gray('disabled')} for ${capitalizedBrowserName(browser)}`
}

export function compatibilityManifestFilteredKeys(
  browser: DevOptions['browser'],
  filteredCount: number
) {
  return `${colors.gray('►►►')} Compatibility: Filtered ${colors.gray(String(filteredCount))} manifest key(s) for ${capitalizedBrowserName(browser)}`
}
