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
  lines.push(
    `Restart the dev server to pick up changes to manifest entrypoints.`
  )
  lines.push('')
  if (fileRemoved) {
    lines.push(`${colors.red('PATH BEFORE')} ${colors.underline(fileRemoved)}`)
  }
  if (fileAdded) {
    lines.push(`${colors.green('PATH AFTER')} ${colors.underline(fileAdded)}`)
  }
  return lines.join('\n')
}

export function legacyManifestPathWarning(legacyPath: string) {
  const lines: string[] = []
  lines.push(`${prefix('warn')} Deprecated manifest path detected.`)
  lines.push(
    `Extension.js rewrites it to the standardized folders in the next major.`
  )
  lines.push('')
  lines.push(`${colors.brightBlue('PATH')} ${colors.underline(legacyPath)}`)
  return lines.join('\n')
}

export function fatalManifestShapeFixed(field: string, detail: string) {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} Repaired a manifest field Chrome refuses to load the extension over.`
  )
  lines.push(`Fix it in your manifest.json.`)
  lines.push('')
  lines.push(
    `${colors.brightBlue('FIELD')} ${colors.underline(field)}, ${detail}`
  )
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

export function missingGeckoDataCollectionPermissions() {
  const lines: string[] = []
  lines.push(
    `${prefix('warn')} addons.mozilla.org requires ${colors.yellow('browser_specific_settings.gecko.data_collection_permissions')} for new add-ons.`
  )
  lines.push(
    `Declare {"required": ["none"]} if this extension transmits no data.`
  )
  lines.push('')
  lines.push(
    `${colors.brightBlue('DOCS')} ${colors.underline('https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/')}`
  )
  return lines.join('\n')
}

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  const lines: string[] = []
  lines.push(`Invalid ${colors.yellow('manifest.json')}.`)
  lines.push(`Update your manifest and try again.`)
  lines.push('')
  lines.push(`${colors.red('REASON')} ${colors.red(String(error))}`)
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
