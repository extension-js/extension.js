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
  const fileRemovedText = fileRemoved
    ? `${colors.brightBlue('PATH')} ${colors.red('REMOVED')} ${colors.underline(fileRemoved)}\n`
    : ''
  const fileAddedText = fileAdded
    ? `${colors.brightBlue('PATH')} ${colors.green('ADDED')} ${colors.underline(fileAdded)}`
    : ''
  return (
    `${colors.red('ERROR')} Entrypoint Change Detected\n` +
    `Changing the path of HTML or script files after compilation requires a server restart.\n` +
    fileRemovedText +
    fileAddedText
  )
}

export function manifestEntrypointChangeRestarting(filePath: string) {
  return `${getLoggingPrefix('manifest.json', 'warn')} Entrypoint change detected at ${colors.underline(filePath)}. Restarting dev server to recompile...`
}

export function manifestFieldError(
  manifestName: string,
  manifestField: string,
  filePath: string
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
  return (
    '' +
    `${
      isPage
        ? `Check the ${colors.yellow('pages')} folder in your project root directory.\n\n`
        : `Check the ${colors.yellow(fieldLabel)} field in your ${colors.yellow('manifest.json')} file.\n\n`
    }` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function legacyManifestPathWarning(legacyPath: string) {
  return (
    `${getLoggingPrefix('manifest.json', 'warn')} Deprecated Path Detected\n` +
    `Found legacy output path ${colors.yellow(legacyPath)}. ` +
    `This will be rewritten to standardized folders in the next major.`
  )
}

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Invalid Manifest\n\n` +
    `Update your ${colors.yellow('manifest.json')} file and try again.\n\n` +
    colors.red(error.toString())
  )
}
