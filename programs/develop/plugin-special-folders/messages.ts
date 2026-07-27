// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../lib/messaging'

export function serverRestartRequiredFromSpecialFolderMessageOnly(
  addingOrRemoving: string,
  folder: string,
  typeOfAsset: string
) {
  // Warn, not error: the build succeeded and only a restart is outstanding.
  // The old `ERROR in ` head also collided with the rspack stats text that
  // downstream tooling matches on, so a restart notice read as a failed build.
  return (
    `${prefix('warn')} ${addingOrRemoving} ${colors.yellow(typeOfAsset)} in ` +
    `${colors.underline(`${folder}/`)} needs a dev server restart to apply.`
  )
}

export function specialFoldersSetupSummary(
  hasPublic: boolean,
  copyEnabled: boolean,
  ignoredCount: number
) {
  return (
    `${prefix('debug')} folders  setup public=${String(hasPublic)} ` +
    `copy=${String(copyEnabled)} ignored=${String(ignoredCount)}`
  )
}

export function specialFolderChangeDetected(
  action: 'add' | 'remove',
  folder: 'pages' | 'scripts',
  relativePath: string
) {
  return (
    `${prefix('debug')} folders  change=${action} scope=${folder} ` +
    `path=${relativePath}`
  )
}
