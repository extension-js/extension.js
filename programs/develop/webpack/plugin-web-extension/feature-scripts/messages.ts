// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import colors from 'pintor'

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
