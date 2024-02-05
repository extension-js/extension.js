import path from 'path'
import fs from 'fs'
import {Compilation} from 'webpack'

export function isUsingReact(projectDir: string) {
  const packageJsonPath = path.join(projectDir, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = require(packageJsonPath)
  const reactAsDevDep =
    packageJson.devDependencies && packageJson.devDependencies.react
  const reactAsDep = packageJson.dependencies && packageJson.dependencies.react

  return !!(reactAsDevDep || reactAsDep)
}

export function shouldExclude(path: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => {
    return path.includes(pattern)
  })
}

export function getResolvedPath(
  context: string,
  filePath: string,
  basePath: string
) {
  // Ensure the filePath is relative to the context
  const relativePath = path.relative(context, filePath)

  // Normalize to avoid issues with different OS path formats
  const pathNormalized = path.normalize(relativePath)
  const prefixedBasePath = basePath ? `/${basePath}` : ''
  const publicPath = path.join(prefixedBasePath, pathNormalized)
  return path.normalize(publicPath)
}

export function isCompilationEntry(
  compilation: Compilation,
  filePath: string
): boolean {
  const context = compilation.compiler.context
  const filePathAbsolute = path.resolve(context, filePath)
  return Object.keys(compilation.assets).some((assetName) => {
    const assetPathAbsolute = path.resolve(context, assetName)
    return filePathAbsolute === assetPathAbsolute
  })
}

export function getCompilationEntryName(
  compilation: Compilation,
  filePath: string
): string {
  // This simplistic approach assumes entries are directly named by their output file names.
  const context = compilation.compiler.context
  const filePathAbsolute = path.resolve(context, filePath)

  const entryName = Object.keys(compilation.assets).find((assetName) => {
    const assetPathAbsolute = path.resolve(context, assetName)
    return filePathAbsolute === assetPathAbsolute
  })

  return entryName || ''
}
