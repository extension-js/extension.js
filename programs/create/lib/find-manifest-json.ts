//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'

const manifestSearchMaxDepth = 3
const ignoredManifestDirs = new Set(['node_modules', '.git'])

export async function findManifestJsonPath(
  projectPath: string
): Promise<string> {
  // Common locations first
  const candidates = [
    path.join(projectPath, 'manifest.json'),
    path.join(projectPath, 'src', 'manifest.json'),
    path.join(projectPath, 'extension', 'manifest.json'),
    path.join(projectPath, 'extension', 'src', 'manifest.json')
  ]

  for (const candidate of candidates) {
    try {
      await fs.promises.access(candidate)
      return candidate
    } catch {}
  }

  // Fallback: search shallow tree for manifest.json
  const queue: Array<{dir: string; depth: number}> = [
    {dir: projectPath, depth: 0}
  ]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue

    let entries: Array<fs.Dirent>
    try {
      entries = await fs.promises.readdir(current.dir, {withFileTypes: true})
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'manifest.json') {
        return path.join(current.dir, entry.name)
      }
      if (
        entry.isDirectory() &&
        current.depth < manifestSearchMaxDepth &&
        !ignoredManifestDirs.has(entry.name)
      ) {
        queue.push({
          dir: path.join(current.dir, entry.name),
          depth: current.depth + 1
        })
      }
    }
  }

  throw new Error(
    `Could not locate manifest.json under ${projectPath}. ` +
      `Checked common paths and searched up to depth ${manifestSearchMaxDepth}.`
  )
}
