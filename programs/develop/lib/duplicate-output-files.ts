// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type {OutputFile} from './output-files'

// Below this a second copy costs nothing a reader would act on, and hashing
// every small file of a large build would cost more than it finds.
export const DUPLICATE_OUTPUT_THRESHOLD_BYTES = 256 * 1024

export interface DuplicateOutputGroup {
  names: string[]
  size: number
}

function sha256Of(filePath: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  } catch {
    return null
  }
}

// Two files of different lengths cannot be the same bytes, so only a size
// that occurs twice above the threshold is read, and the hash settles it.
export function findDuplicateOutputFiles(
  outputPath: string,
  files: OutputFile[],
  threshold: number = DUPLICATE_OUTPUT_THRESHOLD_BYTES
): DuplicateOutputGroup[] {
  const bySize = new Map<number, OutputFile[]>()

  for (const file of files) {
    if (file.size < threshold) continue

    const same = bySize.get(file.size) ?? []
    same.push(file)
    bySize.set(file.size, same)
  }

  const groups: DuplicateOutputGroup[] = []

  for (const [size, same] of bySize) {
    if (same.length < 2) continue

    const byHash = new Map<string, string[]>()

    for (const file of same) {
      const hash = sha256Of(path.join(outputPath, file.name))
      if (!hash) continue

      const names = byHash.get(hash) ?? []
      names.push(file.name)
      byHash.set(hash, names)
    }

    for (const names of byHash.values()) {
      if (names.length < 2) continue

      groups.push({names: [...names].sort(), size})
    }
  }

  return groups.sort(
    (a, b) => b.size - a.size || a.names[0].localeCompare(b.names[0])
  )
}

interface AssetInfoLike {
  info?: {sourceFilename?: unknown}
}

export interface AssetSourceReader {
  getAsset?: (name: string) => unknown
}

// An asset the bundler emitted from an import carries the file it came from,
// which is the one half of a pair the warning can name a cause for. A copy a
// config plugin or public/ added carries nothing, and is named as the copy.
export function importedAssetSources(
  compilation: AssetSourceReader | undefined,
  groups: DuplicateOutputGroup[]
): Map<string, string> {
  const sources = new Map<string, string>()

  for (const group of groups) {
    for (const name of group.names) {
      try {
        const asset = compilation?.getAsset?.(name) as
          | AssetInfoLike
          | null
          | undefined
        const source = asset?.info?.sourceFilename

        if (typeof source === 'string' && source) sources.set(name, source)
      } catch {
        // The cause only decorates the warning.
      }
    }
  }

  return sources
}
