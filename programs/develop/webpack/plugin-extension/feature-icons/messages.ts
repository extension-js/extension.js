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

export function iconsEmitSummary(
  feature: string,
  stats: {
    entries: number
    underPublic: number
    emitted: number
    missing: number
  }
) {
  return (
    `Icons ${colors.yellow(feature)} — ` +
    `entries ${colors.gray(String(stats.entries))}, ` +
    `public ${colors.gray(String(stats.underPublic))}, ` +
    `emitted ${colors.gray(String(stats.emitted))}, ` +
    `missing ${colors.gray(String(stats.missing))}`
  )
}

export function iconsDepsTracked(addedCount: number) {
  return `Icons file dependencies tracked: ${colors.gray(String(addedCount))}`
}

export function iconsNormalizationSummary(
  beforeKeys: string[],
  afterKeys: string[],
  changedCount: number
) {
  return (
    `Icons include normalization — keys ${colors.gray(String(beforeKeys.length))} → ${colors.gray(String(afterKeys.length))}, ` +
    `normalized ${colors.gray(String(changedCount))}`
  )
}

export function iconsManifestChangeDetected(
  field: string,
  before?: string,
  after?: string
) {
  const parts = [
    `Manifest icons change detected in ${colors.yellow(field)}`,
    before ? `${colors.gray('before')} ${colors.underline(before)}` : '',
    after ? `${colors.gray('after')} ${colors.underline(after)}` : ''
  ].filter(Boolean)
  return parts.join(' — ')
}
