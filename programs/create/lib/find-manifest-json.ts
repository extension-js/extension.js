//  ██████╗██████╗ ███████╗ █████╗ ████████╗███████╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗╚══██╔══╝██╔════╝
// ██║     ██████╔╝█████╗  ███████║   ██║   █████╗
// ██║     ██╔══██╗██╔══╝  ██╔══██║   ██║   ██╔══╝
// ╚██████╗██║  ██║███████╗██║  ██║   ██║   ███████╗
//  ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as messages from './messages'

const manifestSearchMaxDepth = 3
const ignoredManifestDirs = new Set(['node_modules', '.git'])

export async function findManifestJsonPath(
  projectPath: string
): Promise<string> {
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
    } catch {
      // Ignore
    }
  }

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

  // A web-only template with no manifest is a legal input, so this refusal
  // travels framed on the error instead of reaching the user as a stack.
  throw new Error(
    messages.manifestNotFound(projectPath, manifestSearchMaxDepth)
  )
}

// Both scaffold steps that personalize the manifest read it the same way, so
// an absent and an unparseable file refuse through one framed path.
export async function readManifestJson(projectPath: string): Promise<{
  manifestJsonPath: string
  manifestJson: Record<string, unknown>
}> {
  const manifestJsonPath = await findManifestJsonPath(projectPath)

  try {
    const raw = await fs.promises.readFile(manifestJsonPath, 'utf-8')

    return {manifestJsonPath, manifestJson: JSON.parse(raw)}
  } catch (error) {
    throw new Error(messages.manifestNotParseable(manifestJsonPath, error))
  }
}
