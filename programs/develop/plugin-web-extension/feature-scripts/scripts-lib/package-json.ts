// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020-present Cezar Augusto - presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'

function findUpLocalSync(
  filename: string,
  options: {cwd: string}
): string | undefined {
  const root = path.parse(options.cwd).root
  let currentDir = options.cwd

  while (true) {
    const candidate = path.join(currentDir, filename)

    try {
      const stat = fs.statSync(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // Ignore missing candidates while walking upward.
    }

    if (currentDir === root) return undefined
    currentDir = path.dirname(currentDir)
  }
}

export function findNearestPackageJsonSync(
  manifestPath: string
): string | null {
  try {
    const manifestDir = path.dirname(manifestPath)
    return findUpLocalSync('package.json', {cwd: manifestDir}) || null
  } catch {
    return null
  }
}
