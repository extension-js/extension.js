export function webextensionPolyfillNotFound() {
  return (
    `Warning: webextension-polyfill not found. ` +
    `Browser API polyfill will not be available.\n` +
    `To fix this, install webextension-polyfill: npm install webextension-polyfill`
  )
}

import colors from 'pintor'
import type {DevOptions} from '../../webpack-types'

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
