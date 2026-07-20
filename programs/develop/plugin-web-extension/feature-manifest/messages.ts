// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'

function getLoggingPrefix(
  feature: string,
  type: 'warn' | 'info' | 'error' | 'success'
) {
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

  if (isAuthor) {
    const base = type === 'error' ? 'ERROR Author says' : '⏵⏵⏵ Author says'
    return `${colors.brightMagenta(base)} ${feature}`
  }

  if (type === 'error') return `${colors.red('ERROR')} ${feature}`
  if (type === 'warn') return `${colors.brightYellow('⏵⏵⏵')} ${feature}`
  const arrow = type === 'info' ? colors.gray('⏵⏵⏵') : colors.green('⏵⏵⏵')

  return `${arrow} ${feature}`
}

export function serverRestartRequiredFromManifestError(
  fileAdded: string,
  fileRemoved: string
) {
  const lines: string[] = []
  // Short actionable message, consistent with MESSAGE_STYLE.md
  lines.push(
    `Entrypoint references changed. Restart the dev server to pick up changes to manifest entrypoints.`
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
  lines.push(
    `⚠ Deprecated manifest path detected. This will be rewritten to standardized folders in the next major.`
  )
  lines.push('')
  lines.push(`${colors.brightBlue('PATH')} ${colors.underline(legacyPath)}`)
  return lines.join('\n')
}

export function fatalManifestShapeFixed(field: string, detail: string) {
  const lines: string[] = []
  lines.push(
    `⚠ Repaired a manifest field Chrome refuses to load the extension over. Fix it in your manifest.json.`
  )
  lines.push('')
  lines.push(
    `${colors.brightBlue('FIELD')} ${colors.underline(field)}, ${detail}`
  )
  return lines.join('\n')
}

export function missingGeckoDataCollectionPermissions() {
  const lines: string[] = []
  lines.push(
    `⚠ addons.mozilla.org requires ${colors.yellow('browser_specific_settings.gecko.data_collection_permissions')} for new add-ons. Declare {"required": ["none"]} if this extension transmits no data.`
  )
  lines.push('')
  lines.push(
    `${colors.brightBlue('DOCS')} ${colors.underline('https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/')}`
  )
  return lines.join('\n')
}

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  const lines: string[] = []
  lines.push(
    `Invalid ${colors.yellow('manifest.json')}. Update your manifest and try again.`
  )
  lines.push('')
  lines.push(`${colors.red('ERROR')} ${colors.red(String(error))}`)
  return lines.join('\n')
}

export function manifestIncludeSummary(browser: string, manifestPath: string) {
  return `Manifest include summary, browser=${colors.yellow(browser)}, path=${colors.underline(manifestPath)}`
}

export function manifestEmitSuccess() {
  return `Manifest emitted to assets (schema stripped).`
}

export function manifestOverridesSummary(
  overrideKeys: number,
  devCssStubsAdded: number
) {
  return `Manifest overrides, keys=${colors.gray(String(overrideKeys))}, devCssStubsAdded=${colors.gray(String(devCssStubsAdded))}`
}

export function manifestDepsTracked(addedCount: number) {
  return `Manifest file dependencies tracked: ${colors.gray(String(addedCount))}`
}

export function manifestLegacyWarningsSummary(count: number) {
  return `Manifest legacy warnings, count=${colors.gray(String(count))}`
}
