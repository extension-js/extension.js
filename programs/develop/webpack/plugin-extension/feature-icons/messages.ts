import colors from 'pintor'

export function iconsMissingFile(
  manifestField: string,
  filePath: string,
  opts?: {publicRootHint?: boolean}
) {
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(
    `The icon path must point to an existing file that will be packaged with the extension.`
  )
  lines.push(
    `Browsers can reject or crash the extension when required icons are missing. We fail the build early to protect you.`
  )
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.yellow('public/')}), not your source directory.`
    )
  }
  lines.push('')
  lines.push(`${colors.red('NOT FOUND')} ${colors.underline(filePath)}`)
  return lines.join('\n')
}

export function manifestIconsEntrypointChange(
  manifestField?: string,
  pathAfter?: string,
  pathBefore?: string
) {
  const lines: string[] = []
  const fieldLabel = manifestField ? manifestField.replace(/\//g, '.') : 'icons'
  lines.push(
    `Entrypoint references changed in ${colors.yellow(
      fieldLabel
    )}. Restart the dev server to pick up changes to manifest icons.`
  )
  lines.push('')
  if (pathBefore) {
    lines.push(`${colors.red('PATH BEFORE')} ${colors.underline(pathBefore)}`)
  }
  if (pathAfter) {
    lines.push(`${colors.green('PATH AFTER')} ${colors.underline(pathAfter)}`)
  }
  return lines.join('\n')
}
