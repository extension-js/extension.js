import * as path from 'path'
import colors from 'pintor'

function getLoggingPrefix(
  feature: string,
  type: 'warn' | 'info' | 'error' | 'success'
) {
  if (type === 'error') return `${colors.red('ERROR')} ${feature}`
  if (type === 'warn') return `${colors.brightYellow('►►►')} ${feature}`
  const arrow = type === 'info' ? colors.blue('►►►') : colors.green('►►►')
  return `${arrow} ${feature}`
}

function shortPath(p: string) {
  try {
    const cwd = process.cwd()
    const rel = path.relative(cwd, p)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel
    return path.basename(p)
  } catch {
    return path.basename(p)
  }
}

export function javaScriptError(
  errorSourcePath: string,
  missingFilePath: string
) {
  return (
    `${getLoggingPrefix('HTML', 'error')} File Not Found\n` +
    `Check your ${colors.yellow('<script>')} tags in ${colors.underline(shortPath(errorSourcePath))}.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(shortPath(missingFilePath))}`
  )
}

export function cssError(errorSourcePath: string, missingFilePath: string) {
  return (
    `${getLoggingPrefix('HTML', 'error')} File Not Found\n` +
    `Check your ${colors.yellow('<link>')} tags in ${colors.underline(shortPath(errorSourcePath))}.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(shortPath(missingFilePath))}`
  )
}

export function staticAssetError(
  errorSourcePath: string,
  missingFilePath: string
) {
  const extname = path.extname(missingFilePath)
  return (
    `${getLoggingPrefix('HTML', 'warn')} File Not Found\n` +
    `Check your ${colors.yellow('*' + extname)} assets in ${colors.underline(shortPath(errorSourcePath))}.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(shortPath(missingFilePath))}`
  )
}

export function fileNotFound(
  errorSourcePath: string | undefined,
  missingFilePath: string
) {
  if (!errorSourcePath) {
    throw new Error('This operation is impossible. Please report a bug.')
  }
  switch (path.extname(missingFilePath)) {
    case '.js':
    case '.ts':
    case '.jsx':
    case '.tsx':
      return javaScriptError(errorSourcePath, missingFilePath)
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return cssError(errorSourcePath, missingFilePath)
    default:
      return staticAssetError(errorSourcePath, missingFilePath)
  }
}

export function htmlFileNotFoundMessageOnly(
  context: 'script' | 'style' | 'static' = 'static'
) {
  const label =
    context === 'script'
      ? '<script>'
      : context === 'style'
        ? '<link>'
        : '*.<ext>'
  return (
    `${getLoggingPrefix('HTML', 'error')} File Not Found\n` +
    `Check your ${colors.yellow(label)} references.`
  )
}

export function serverRestartRequiredFromHtml(filePath: string) {
  return (
    `${getLoggingPrefix('Detected', 'warn')} changes to ${colors.yellow('<script>')} or ${colors.yellow('<link rel="stylesheet">')} references in HTML.\n` +
    `${colors.gray('PATH')} ${colors.underline(shortPath(filePath))}`
  )
}

export function manifestFieldMessageOnly(manifestField: string) {
  const manifestFieldName = manifestField.startsWith('content_scripts')
    ? `content_scripts`
    : manifestField.replace('/', '.')
  const contentIndex = manifestField.split('-')[1]
  const isContentScripts = manifestField.startsWith('content_scripts')
  const fieldLabel = isContentScripts
    ? `content_scripts (index ${contentIndex})`
    : manifestFieldName
  return `Check the ${colors.yellow(fieldLabel)} field in your ${colors.yellow('manifest.json')} file.`
}
