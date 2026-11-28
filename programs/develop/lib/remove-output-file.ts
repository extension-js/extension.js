// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// Removes one file a step wrote under an output folder, then every parent
// folder that removal left empty. Never reaches outside the output folder.
export function removeOutputFile(outputPath: string, name: string): void {
  const root = path.resolve(outputPath)
  const target = path.resolve(root, name)

  if (!target.startsWith(root + path.sep)) return

  try {
    fs.rmSync(target, {force: true})

    let folder = path.dirname(target)

    while (folder.startsWith(root + path.sep)) {
      fs.rmdirSync(folder)
      folder = path.dirname(folder)
    }
  } catch {
    // A folder that still holds files stays, and so does a file in use.
  }
}
