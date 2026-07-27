// ██╗ ██████╗ ██████╗ ███╗   ██╗███████╗
// ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝
// ██║██║     ██║   ██║██╔██╗ ██║███████╗
// ██║██║     ██║   ██║██║╚██╗██║╚════██║
// ██║╚██████╗╚██████╔╝██║ ╚████║███████║
// ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../../lib/messaging'

export function iconsMissingFile(
  manifestField: string,
  filePath: string,
  opts?: {publicRootHint?: boolean; fatal?: boolean}
) {
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(
    `The icon path must point to an existing file that will be packaged with the extension.`
  )
  // The build only stops for the fields a browser refuses the whole extension
  // over, so the promise has to track the severity that ships with it.
  lines.push(
    opts?.fatal
      ? `Browsers reject the whole extension when this file is missing.\nThe build stops here to protect you.`
      : `Browsers can reject or misrender the extension when this file is missing.\nThe build continues.`
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

export function themeImageIsEmpty(manifestField: string, filePath: string) {
  const lines: string[] = []
  lines.push(
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.`
  )
  lines.push(`The theme image is empty (0 bytes).`)
  lines.push(
    `Chrome loads the extension but drops the entire theme, so no colors or images apply.`
  )
  lines.push('')
  lines.push(`${colors.red('EMPTY FILE')} ${colors.underline(filePath)}`)
  return lines.join('\n')
}

export function manifestIconsEntrypointChange(
  manifestField?: string,
  pathAfter?: string,
  pathBefore?: string
) {
  const lines: string[] = []
  const fieldLabel = manifestField ? manifestField.replace(/\//g, '.') : 'icons'
  lines.push(`Entrypoint references changed in ${colors.yellow(fieldLabel)}.`)
  lines.push(`Restart the dev server to pick up changes to manifest icons.`)
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
    `${prefix('debug')} icons    emit feature=${feature} ` +
    `entries=${stats.entries} public=${stats.underPublic} ` +
    `emitted=${stats.emitted} missing=${stats.missing}`
  )
}

export function iconsDepsTracked(addedCount: number) {
  return `${prefix('debug')} icons    deps=${String(addedCount)}`
}

export function iconsNormalizationSummary(
  beforeKeys: string[],
  afterKeys: string[],
  changedCount: number
) {
  return (
    `${prefix('debug')} icons    normalize keysBefore=${beforeKeys.length} ` +
    `keysAfter=${afterKeys.length} changed=${changedCount}`
  )
}
