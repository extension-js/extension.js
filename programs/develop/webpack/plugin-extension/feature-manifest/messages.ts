import colors from 'pintor'

function getLoggingPrefix(
  feature: string,
  type: 'warn' | 'info' | 'error' | 'success'
) {
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

  if (isAuthor) {
    const base = type === 'error' ? 'ERROR Author says' : '►►► Author says'
    return `${colors.brightMagenta(base)} ${feature}`
  }

  if (type === 'error') return `${colors.red('ERROR')} ${feature}`
  if (type === 'warn') return `${colors.brightYellow('►►►')} ${feature}`
  const arrow = type === 'info' ? colors.gray('►►►') : colors.green('►►►')

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

export function manifestFieldError(
  manifestName: string,
  manifestField: string,
  filePath: string,
  opts?: {publicRootHint?: boolean; overrideNotFoundPath?: string}
) {
  const manifestFieldName = manifestField.startsWith('content_scripts')
    ? `content_scripts`
    : manifestField.replace('/', '.')
  const contentIndex = manifestField.split('-')[1]
  const isPage = manifestField.startsWith('pages')
  const isContentScripts = manifestField.startsWith('content_scripts')
  const fieldLabel = isContentScripts
    ? `content_scripts (index ${contentIndex})`
    : manifestFieldName
  const lines: string[] = []
  lines.push(
    isPage
      ? `Check the ${colors.yellow('pages')} folder in your project root directory.`
      : `Check the ${colors.yellow(fieldLabel)} field in your ${colors.yellow('manifest.json')} file.`
  )
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.yellow('public/')}), not your source directory.`
    )
  }
  lines.push('')
  lines.push(
    `${colors.red('NOT FOUND')} ${colors.underline(
      opts?.overrideNotFoundPath || filePath
    )}`
  )
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
  return `Manifest include summary — browser=${colors.yellow(browser)}, path=${colors.underline(manifestPath)}`
}

export function manifestEmitSuccess() {
  return `Manifest emitted to assets (schema stripped).`
}

export function manifestOverridesSummary(
  overrideKeys: number,
  devCssStubsAdded: number
) {
  return `Manifest overrides — keys=${colors.gray(String(overrideKeys))}, devCssStubsAdded=${colors.gray(String(devCssStubsAdded))}`
}

export function manifestDepsTracked(addedCount: number) {
  return `Manifest file dependencies tracked: ${colors.gray(String(addedCount))}`
}

export function manifestValidationScanSummary(
  fieldsChecked: number,
  errorsFound: number
) {
  return `Manifest validation — fieldsChecked=${colors.gray(String(fieldsChecked))}, errors=${colors.gray(String(errorsFound))}`
}

export function manifestLegacyWarningsSummary(count: number) {
  return `Manifest legacy warnings — count=${colors.gray(String(count))}`
}

export function manifestRecompileDetected(
  fileAdded?: string,
  fileRemoved?: string
) {
  const parts = [
    `Manifest entrypoints changed`,
    fileRemoved
      ? `${colors.gray('before')} ${colors.underline(fileRemoved)}`
      : '',
    fileAdded ? `${colors.gray('after')} ${colors.underline(fileAdded)}` : ''
  ].filter(Boolean)
  return parts.join(' — ')
}
