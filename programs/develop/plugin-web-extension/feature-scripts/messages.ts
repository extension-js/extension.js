// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import colors from 'pintor'

export function backgroundIsRequiredMessageOnly(backgroundChunkName: string) {
  return (
    '' +
    `Check the ${colors.yellow(backgroundChunkName.replace('/', '.'))} ` +
    `field in your ${colors.yellow('manifest.json')} file.`
  )
}

export function scriptsIncludeSummary(
  featureCount: number,
  devMode: boolean,
  browser: string
) {
  return `Scripts include summary — features=${colors.gray(String(featureCount))}, dev=${colors.gray(String(devMode))}, browser=${colors.yellow(browser)}`
}

export function scriptsEntriesSummary(
  entriesAdded: number,
  publicTracked: number
) {
  return `Scripts entries — added=${colors.gray(String(entriesAdded))}, publicTracked=${colors.gray(String(publicTracked))}`
}

export function scriptsManifestChangeDetected(before?: string, after?: string) {
  const parts = [
    `Manifest scripts change detected`,
    before ? `${colors.gray('before')} ${colors.underline(before)}` : '',
    after ? `${colors.gray('after')} ${colors.underline(after)}` : ''
  ].filter(Boolean)
  return parts.join(' — ')
}

export function reservedScriptsFolder(relPath: string, indicators: string[]) {
  const reasons = indicators.map((r) => `- ${colors.gray(r)}`).join('\n')
  return (
    `${colors.red('ERROR')} scripts/ is a reserved folder in Extension.js.\n` +
    `Every file under ${colors.yellow('scripts/')} is wrapped with the browser ` +
    `content-script mount runtime, so Node.js-only files placed here will fail ` +
    `to parse or run.\n` +
    `Rename the folder at the project root (for example ${colors.yellow('bin/')}, ` +
    `${colors.yellow('tools/')}, ${colors.yellow('ops/')}, ${colors.yellow('tasks/')}, ` +
    `or ${colors.yellow('ci-scripts/')}) or move the file out of scripts/.\n\n` +
    `${colors.red('NODE.JS SHAPE')}\n${reasons}\n` +
    `${colors.red('NOT ALLOWED')} ${colors.underline(relPath)}`
  )
}
