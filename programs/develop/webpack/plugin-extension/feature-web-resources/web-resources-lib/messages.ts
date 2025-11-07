import colors from 'pintor'

export function warFieldError(
  filePath: string,
  opts?: {overrideNotFoundPath?: string; publicRootHint?: boolean}
) {
  const displayPath = opts?.overrideNotFoundPath || filePath
  const lines: string[] = []
  // Context header
  lines.push(`${colors.yellow('web_accessible_resources')}: file not found`)

  // What WAR is for and what it is not
  lines.push(
    `Only list assets your pages fetch with ${colors.yellow('chrome.runtime.getURL()')}. Imports from content scripts are bundled automatically and do not need to be listed here.`
  )

  // Authoring guidance based on path style
  if (opts?.publicRootHint) {
    lines.push(
      `To reference files in ${colors.yellow('public/')}, use a leading '/' (e.g. ${colors.yellow('/open-panel.gif')}). These resolve from the built extension root.`
    )
    lines.push(
      `Fix: Add the file to ${colors.yellow('public/')} or update the path to the correct '/...' location.`
    )
  } else {
    lines.push(
      `Relative paths must point to a real source file so the build can emit it.`
    )
    lines.push(
      `Fix: Create the missing file or update the path to an existing source file.`
    )
  }

  // Learn more
  lines.push(
    `Learn more: ${colors.underline('https://extension.js.org/docs/development/web-accessible-resources')}`
  )

  // Final missing path
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
