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
  if (opts?.publicRootHint) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from ${colors.yellow('public/')}), not your source directory.`
    )
  }
  lines.push('')
  lines.push(`${colors.red('NOT FOUND')} ${colors.underline(filePath)}`)
  return lines.join('\n')
}
