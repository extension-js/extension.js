// ███████╗██████╗ ███████╗ ██████╗██╗ █████╗ ██╗      ███████╗ ██████╗ ██╗     ██████╗ ███████╗██████╗ ███████╗
// ██╔════╝██╔══██╗██╔════╝██╔════╝██║██╔══██╗██║      ██╔════╝██╔═══██╗██║     ██╔══██╗██╔════╝██╔══██╗██╔════╝
// ███████╗██████╔╝█████╗  ██║     ██║███████║██║█████╗█████╗  ██║   ██║██║     ██║  ██║█████╗  ██████╔╝███████╗
// ╚════██║██╔═══╝ ██╔══╝  ██║     ██║██╔══██║██║╚════╝██╔══╝  ██║   ██║██║     ██║  ██║██╔══╝  ██╔══██╗╚════██║
// ███████║██║     ███████╗╚██████╗██║██║  ██║███████╗ ██║     ╚██████╔╝███████╗██████╔╝███████╗██║  ██║███████║
// ╚══════╝╚═╝     ╚══════╝ ╚═════╝╚═╝╚═╝  ╚═╝╚══════╝ ╚═╝      ╚═════╝ ╚══════╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'

export function serverRestartRequiredFromSpecialFolderMessageOnly(
  addingOrRemoving: string,
  folder: string,
  typeOfAsset: string
) {
  return (
    `${colors.red('ERROR')} in ${colors.yellow('manifest.json')} entrypoint: ` +
    `${addingOrRemoving} ${colors.yellow(typeOfAsset)} in ${colors.underline(
      folder + '/'
    )} requires a dev server restart to apply changes.`
  )
}

export function specialFoldersSetupSummary(
  hasPublic: boolean,
  copyEnabled: boolean,
  ignoredCount: number
) {
  return `Special folders setup, public=${String(hasPublic)}, copy=${String(copyEnabled)}, ignored=${String(ignoredCount)}`
}

export function specialFolderChangeDetected(
  action: 'add' | 'remove',
  folder: 'pages' | 'scripts',
  relativePath: string
) {
  return `Special folders change, ${action} in ${folder}/: ${relativePath}`
}
