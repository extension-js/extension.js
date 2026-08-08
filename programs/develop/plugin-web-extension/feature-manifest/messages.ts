// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {type Channel, prefix} from '../../lib/messaging'

export function serverRestartRequiredFromManifestError(
  fileAdded: string,
  fileRemoved: string
) {
  const lines: string[] = []
  lines.push(`Entrypoint references changed.`)
  if (fileRemoved) {
    lines.push(`${colors.gray('EXPECTED')} ${colors.underline(fileRemoved)}`)
  }
  if (fileAdded) {
    lines.push(`${colors.gray('GOT')} ${colors.underline(fileAdded)}`)
  }
  lines.push(
    `Restart the dev server to pick up changes to manifest entrypoints.`
  )
  return lines.join('\n')
}

export function legacyManifestPathWarning(
  field: string,
  legacyPath: string,
  modernPath: string
) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} The ${colors.blue(field)} field uses a deprecated scaffold path.`
  )
  lines.push(`${colors.gray('PATH')} ${colors.underline(legacyPath)}`)
  lines.push(
    `Point it at ${colors.underline(modernPath)}; Extension.js already emits the page there.`
  )
  return lines.join('\n')
}

export function fatalManifestShapeFixed(field: string, detail: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} Repaired the ${colors.blue(field)} field, which Chrome refuses to load the extension over.`
  )
  lines.push(`${colors.gray('REASON')} ${colors.underline(detail)}`)
  lines.push(`Fix the field in your ${colors.blue('manifest.json')} file.`)
  return lines.join('\n')
}

export function invalidThemeValue(
  field: string,
  detail: string,
  value: string
) {
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow(field)} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(detail)
  lines.push(
    `Chrome rejects the whole extension when this value is malformed.\nThe build stops here to protect you.`
  )
  lines.push('')
  lines.push(`${colors.red('INVALID VALUE')} ${value}`)
  return lines.join('\n')
}

export function themeNotSupportedByBrowser(browser: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} ${colors.blue(browser)} does not support the ${colors.yellow('theme')} field.`
  )
  lines.push(`The field ships unchanged in the manifest and Safari ignores it.`)
  return lines.join('\n')
}

export function missingGeckoDataCollectionPermissions() {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} addons.mozilla.org requires ${colors.blue('browser_specific_settings.gecko.data_collection_permissions')} for new add-ons.`
  )
  lines.push(
    `Declare ${colors.blue('{"required": ["none"]}')} if this extension transmits no data.`
  )
  lines.push(
    `See ${colors.underline('https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/')} for details.`
  )
  return lines.join('\n')
}

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  const lines: string[] = []
  lines.push(`Can't read your ${colors.blue('manifest.json')} file.`)
  lines.push(`${colors.gray('REASON')} ${colors.underline(String(error))}`)
  lines.push(`Update your manifest and try again.`)
  return lines.join('\n')
}

export function manifestIncludeSummary(browser: string, manifestPath: string) {
  return (
    `${prefix('debug')} manifest include browser=${browser} ` +
    `path=${manifestPath}`
  )
}

export function manifestEmitSuccess() {
  return `${prefix('debug')} manifest emitted=true schemaStripped=true`
}

export function manifestOverridesSummary(
  overrideKeys: number,
  devCssStubsAdded: number
) {
  return (
    `${prefix('debug')} manifest overrides keys=${String(overrideKeys)} ` +
    `devCssStubs=${String(devCssStubsAdded)}`
  )
}

export function manifestDepsTracked(addedCount: number) {
  return `${prefix('debug')} manifest deps=${String(addedCount)}`
}

export function manifestLegacyWarningsSummary(count: number) {
  return `${prefix('debug')} manifest legacyWarnings=${String(count)}`
}
