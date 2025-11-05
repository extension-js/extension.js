import colors from 'pintor'

function getLoggingPrefix(
  feature: string,
  type: 'warn' | 'info' | 'error' | 'success'
) {
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
    `${colors.red('×')} Entrypoint references changed. Restart the dev server to pick up changes to manifest entrypoints.`
  )
  lines.push('')
  if (fileRemoved) {
    lines.push(
      `${colors.brightBlue('PATH')} ${colors.red('REMOVED')} ${colors.underline(
        fileRemoved
      )}`
    )
  }
  if (fileAdded) {
    lines.push(
      `${colors.brightBlue('PATH')} ${colors.green('ADDED')} ${colors.underline(
        fileAdded
      )}`
    )
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
      ? `${colors.red('×')} Check the ${colors.yellow('pages')} folder in your project root directory.`
      : `${colors.red('×')} Check the ${colors.yellow(fieldLabel)} field in your ${colors.yellow('manifest.json')} file.`
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
    `${colors.red('×')} Invalid ${colors.yellow('manifest.json')}. Update your manifest and try again.`
  )
  lines.push('')
  lines.push(`${colors.red('ERROR')} ${colors.red(String(error))}`)
  return lines.join('\n')
}
