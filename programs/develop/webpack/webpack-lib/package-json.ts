// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'

async function findUpLocal(
  filename: string,
  options: {cwd: string}
): Promise<string | undefined> {
  const root = path.parse(options.cwd).root
  let currentDir = options.cwd

  while (true) {
    const candidate = path.join(currentDir, filename)

    try {
      const stat = await fs.promises.stat(candidate)

      if (stat.isFile()) return candidate
    } catch {
      // Ignore error
    }

    if (currentDir === root) return undefined
    currentDir = path.dirname(currentDir)
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
