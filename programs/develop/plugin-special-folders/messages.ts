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
    `${colors.underline(`${folder}/`)} changes the extension entrypoints.\n` +
    `Restart the dev server to apply the change.`
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

export function unreferencedScriptDropped(relativePaths: string[]) {
  // Warn, not error: the build is valid, the entry is simply not in it. Silence
  // was the real defect, the file went missing and only production said so.
  const list = relativePaths
    .map((entry) => `  ${colors.yellow(entry)}`)
    .join('\n')
  return (
    `${prefix('warn')} Dropped ${relativePaths.length} unreferenced ` +
    `${relativePaths.length === 1 ? 'entry' : 'entries'} from ` +
    `${colors.yellow('scripts/')}:\n${list}\n` +
    `Nothing in this project mentions ` +
    `${relativePaths.length === 1 ? 'that path' : 'those paths'}, so ` +
    `${relativePaths.length === 1 ? 'it was' : 'they were'} treated as dead ` +
    `code. Reference the path where you inject it (for example in the ` +
    `${colors.yellow('chrome.scripting.executeScript')} call) to keep ` +
    `${relativePaths.length === 1 ? 'it' : 'them'} in the build.`
  )
}
