import colors from 'pintor'

export function warFieldError(
  filePath: string,
  opts?: {overrideNotFoundPath?: string; publicRootHint?: boolean}
) {
  const displayPath = opts?.overrideNotFoundPath || filePath
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow('web_accessible_resources')} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(
    `List only files pages must fetch via ${colors.yellow('chrome.runtime.getURL()')}; content script imports are auto-added. For standalone files, point to an existing source file so the build can emit it. See ${colors.underline('https://extension.js.org/docs/development/web-accessible-resources')}`
  )
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (copied from ${colors.yellow('public/')}), not your source directory.`
    )
  }
  lines.push('')
  lines.push(`${colors.red('NOT FOUND')} ${colors.underline(displayPath)}`)
  return lines.join('\n')
}

export function warInvalidMatchPattern(pattern: string) {
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow('web_accessible_resources')} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(
    `Chrome requires match patterns to end with ${colors.yellow('/*')} and not include deeper paths. See ${colors.underline('https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources#manifest_declaration')}`
  )
  lines.push('')
  lines.push(
    `${colors.red('INVALID MATCH PATTERN')} ${colors.underline(pattern)}`
  )
  return lines.join('\n')
}
