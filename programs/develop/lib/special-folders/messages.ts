// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../messaging'

export function packageScriptLeftOut(relativePaths: string[]) {
  const one = relativePaths.length === 1
  const list = relativePaths
    .map((entry) => `  ${colors.yellow(entry)}`)
    .join('\n')

  return (
    `${prefix('debug')} Left ${relativePaths.length} ` +
    `${one ? 'entry' : 'entries'} in ${colors.yellow('scripts/')} out of ` +
    `the build, a package.json script runs ${one ? 'it' : 'them'} and ` +
    `nothing in the extension names ${one ? 'it' : 'them'}:\n${list}`
  )
}

export function devOnlyEntriesLeftOut(relativePaths: string[]) {
  const one = relativePaths.length === 1
  const list = relativePaths
    .map((entry) => `  ${colors.yellow(entry)}`)
    .join('\n')

  return (
    `${prefix('debug')} Left ${relativePaths.length} development-only ` +
    `${one ? 'entry' : 'entries'} out of the production build ` +
    `(a ${colors.yellow('.dev.')} file in pages/ or scripts/):\n${list}`
  )
}

export function excludedEntriesLeftOut(relativePaths: string[]) {
  const one = relativePaths.length === 1
  const list = relativePaths
    .map((entry) => `  ${colors.yellow(entry)}`)
    .join('\n')

  return (
    `${prefix('debug')} Left ${relativePaths.length} ` +
    `${one ? 'entry' : 'entries'} out of the build, ` +
    `${colors.blue('exclude')} in extension.config.js names ${one ? 'it' : 'them'}:\n${list}`
  )
}

export function entryFolderUnreadable(
  relativePath: string,
  folder: string,
  code: string
) {
  return (
    `${colors.yellow(relativePath)} cannot be read (${code}), so the build ` +
    `cannot list the entries in ${colors.yellow(folder)}.\n` +
    `Give your user read access to it, or move it out of ${folder}.`
  )
}
