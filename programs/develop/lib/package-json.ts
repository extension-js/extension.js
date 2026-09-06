// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

// A remote URL joined with a file name reads as "https:/host/..." (or with
// backslashes on Windows), a relative path whose ancestry never holds a
// manifest. Windows drive letters are a single character, so they do not match.
function isUrlShaped(target: string): boolean {
  // path.join on Windows also prefixes the URL with a dot segment.
  return /^(?:\.[\\/])?[a-z][a-z0-9+.-]+:[\\/]+/i.test(target)
}

async function findUpLocal(
  filename: string,
  options: {cwd: string}
): Promise<string | undefined> {
  if (isUrlShaped(options.cwd)) return undefined
  const root = path.parse(path.resolve(options.cwd)).root
  let currentDir = path.resolve(options.cwd)

  while (true) {
    const candidate = path.join(currentDir, filename)

    try {
      const stat = await fs.promises.stat(candidate)

      if (stat.isFile()) return candidate
    } catch {
      // Ignore
    }

    // A relative start (a URL handed in as a path) never reaches the
    // filesystem root, so stop as soon as the walk stops climbing.
    const parentDir = path.dirname(currentDir)
    if (currentDir === root || parentDir === currentDir) return undefined
    currentDir = parentDir
  }
}

function findUpLocalSync(
  filename: string,
  options: {cwd: string}
): string | undefined {
  if (isUrlShaped(options.cwd)) return undefined
  const root = path.parse(path.resolve(options.cwd)).root
  let currentDir = path.resolve(options.cwd)

  while (true) {
    const candidate = path.join(currentDir, filename)

    try {
      const stat = fs.statSync(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // Ignore
    }

    // A relative start (a URL handed in as a path) never reaches the
    // filesystem root, so stop as soon as the walk stops climbing.
    const parentDir = path.dirname(currentDir)
    if (currentDir === root || parentDir === currentDir) return undefined
    currentDir = parentDir
  }
}

export async function findNearestPackageJson(
  manifestPath: string
): Promise<string | null> {
  try {
    const manifestDir = path.dirname(manifestPath)
    const packageJsonPath = await findUpLocal('package.json', {
      cwd: manifestDir
    })

    return packageJsonPath || null
  } catch (error) {
    console.warn('Failed to find package.json:', error)
    return null
  }
}

export function findNearestPackageJsonSync(
  manifestPath: string
): string | null {
  try {
    const manifestDir = path.dirname(manifestPath)
    const packageJsonPath = findUpLocalSync('package.json', {
      cwd: manifestDir
    })

    return packageJsonPath || null
  } catch (error) {
    console.warn('Failed to find package.json:', error)
    return null
  }
}

export function validatePackageJson(packageJsonPath: string): boolean {
  try {
    if (!fs.existsSync(packageJsonPath)) {
      return false
    }

    const content = fs.readFileSync(packageJsonPath, 'utf-8')
    JSON.parse(content)
    return true
  } catch (error) {
    console.warn('Invalid package.json at:', packageJsonPath, error)
    return false
  }
}
