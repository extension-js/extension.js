//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import path from 'path'

export default function destinationNotWriteable(workingDir: string) {
  const workingDirFolder = path.basename(workingDir)

  console.error(
    `Failed to write in the destination directory. Path for \`${workingDirFolder}\` is not writable.`
  )
  console.error(
    `Ensure you have write permissions for this folder.\nPath: ${workingDirFolder}`
  )
}
