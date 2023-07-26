//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝

import fs from 'fs/promises'
import path from 'path'

export default async function copyDirectory(
  source: string,
  destination: string
) {
  const directoryEntries = await fs.readdir(source, {withFileTypes: true})
  await fs.mkdir(destination, {recursive: true})

  return await Promise.all(
    directoryEntries.map(async (entry) => {
      const sourcePath = path.join(source, entry.name)
      const destinationPath = path.join(destination, entry.name)

      if (entry.isDirectory()) {
        await copyDirectory(sourcePath, destinationPath)
      } else {
        await fs.copyFile(sourcePath, destinationPath)
      }
    })
  )
}
