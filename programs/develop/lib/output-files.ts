// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface OutputFile {
  name: string
  size: number
}

export interface FoldedOutputFiles {
  count: number
  bytes: number
  sourceMapsOnly: boolean
}

// The bundler's stats leave out every asset another asset names as its source
// map, so the folder is the only complete record of what a build wrote.
export function listOutputFiles(outputPath: string): OutputFile[] {
  const files: OutputFile[] = []
  const pending: string[] = ['']

  while (pending.length) {
    const relativeDir = pending.pop() as string
    let entries: fs.Dirent[] = []

    try {
      entries = fs.readdirSync(path.join(outputPath, relativeDir), {
        withFileTypes: true
      })
    } catch {
      continue
    }

    for (const entry of entries) {
      try {
        const name = relativeDir ? `${relativeDir}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          pending.push(name)
        } else if (entry.isFile()) {
          files.push({
            name,
            size: fs.statSync(path.join(outputPath, name)).size
          })
        }
      } catch {
        // Ignore
      }
    }
  }

  return files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export function foldOutputFiles(
  files: OutputFile[],
  listedNames: Iterable<string>
): FoldedOutputFiles {
  const listed = new Set(listedNames)
  const folded = files.filter((file) => !listed.has(file.name))

  return {
    count: folded.length,
    bytes: folded.reduce((total, file) => total + file.size, 0),
    sourceMapsOnly: folded.every((file) => file.name.endsWith('.map'))
  }
}
