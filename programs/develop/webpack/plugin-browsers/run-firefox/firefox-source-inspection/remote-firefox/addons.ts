import * as fs from 'fs'
import * as path from 'path'

export function resolveAddonDirectory(
  baseDir: string,
  inputPath: string
): string {
  let candidate = inputPath.replace(/\"/g, '')

  if (!path.isAbsolute(candidate)) {
    candidate = path.resolve(baseDir, candidate)
  }

  try {
    const stat = fs.statSync(candidate)
    if (stat.isFile()) {
      candidate = path.dirname(candidate)
    }
  } catch {
    // ignore
  }

  const hasManifest = fs.existsSync(path.join(candidate, 'manifest.json'))
  if (hasManifest) return candidate

  const distFirefox = path.join(candidate, 'dist', 'firefox')
  if (fs.existsSync(path.join(distFirefox, 'manifest.json'))) {
    return distFirefox
  }

  return candidate
}
