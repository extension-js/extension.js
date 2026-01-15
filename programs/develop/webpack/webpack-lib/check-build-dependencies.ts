// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import * as fs from 'fs'

/**
 * Find the extension-develop package root directory.
 * Uses __dirname resolution similar to webpack-config.ts
 */
export function findExtensionDevelopRoot(): string | null {
  // Get the directory of this file (webpack-lib/)
  // Resolve to webpack/ parent, then parent again (package root)
  // This matches the pattern in webpack-config.ts: path.resolve(__dirname, '..')
  const webpackLibDir = __dirname
  const webpackDir = path.resolve(webpackLibDir, '..')
  const packageRoot = path.resolve(webpackDir, '..')

  // Verify this is the extension-develop package root
  const packageJsonPath = path.join(packageRoot, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
      if (pkg.name === 'extension-develop') {
        return packageRoot
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  return null
}

/**
 * Load build dependencies from build-dependencies.json
 */
export function loadBuildDependencies(): Record<string, string> {
  const metadataPath = path.join(__dirname, 'build-dependencies.json')

  if (!fs.existsSync(metadataPath)) {
    throw new Error(
      `build-dependencies.json not found at ${metadataPath}. This indicates a corrupted installation.`
    )
  }

  try {
    const content = fs.readFileSync(metadataPath, 'utf-8')
    return JSON.parse(content)
  } catch (error: any) {
    throw new Error(`Failed to load build-dependencies.json: ${error.message}`)
  }
}

/**
 * Check if a dependency is installed in the extension-develop package
 */
function isDependencyInstalled(
  dependency: string,
  packageRoot: string
): boolean {
  const nodeModulesPath = path.join(packageRoot, 'node_modules', dependency)
  return fs.existsSync(nodeModulesPath)
}

/**
 * Check if all build dependencies are installed
 */
export function areBuildDependenciesInstalled(packageRoot: string): boolean {
  const dependencies = loadBuildDependencies()
  return Object.keys(dependencies).every((dep) =>
    isDependencyInstalled(dep, packageRoot)
  )
}

/**
 * Get missing build dependencies
 */
export function getMissingBuildDependencies(packageRoot: string): string[] {
  const dependencies = loadBuildDependencies()
  return Object.keys(dependencies).filter(
    (dep) => !isDependencyInstalled(dep, packageRoot)
  )
}
