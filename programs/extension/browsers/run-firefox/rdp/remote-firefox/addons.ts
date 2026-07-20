// ██████╗ ██╗   ██╗███╗   ██╗      ███████╗██╗██████╗ ███████╗███████╗ ██████╗ ██╗  ██╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║██╔══██╗██╔════╝██╔════╝██╔═══██╗╚██╗██╔╝
// ██████╔╝██║   ██║██╔██╗ ██║█████╗█████╗  ██║██████╔╝█████╗  █████╗  ██║   ██║ ╚███╔╝
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██╔══╝  ██║██╔══██╗██╔══╝  ██╔══╝  ██║   ██║ ██╔██╗
// ██║  ██║╚██████╔╝██║ ╚████║      ██║     ██║██║  ██║███████╗██║     ╚██████╔╝██╔╝ ██╗
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝      ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

export function resolveAddonDirectory(
  baseDir: string,
  inputPath: string
): string {
  let candidate = inputPath.trim()

  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1)
  }

  if (!path.isAbsolute(candidate)) {
    candidate = path.resolve(baseDir, candidate)
  }

  try {
    const stat = fs.statSync(candidate)
    if (stat.isFile()) {
      candidate = path.dirname(candidate)
    }
  } catch {}

  const hasManifest = fs.existsSync(path.join(candidate, 'manifest.json'))
  if (hasManifest) return candidate

  const distFirefox = path.join(candidate, 'dist', 'firefox')
  if (fs.existsSync(path.join(distFirefox, 'manifest.json'))) {
    return distFirefox
  }

  return candidate
}
