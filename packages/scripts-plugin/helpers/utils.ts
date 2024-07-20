import path from 'path'
import fs from 'fs'
import {type Compiler} from 'webpack'

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

export function getRelativePath(from: string, to: string) {
  let relativePath = path.relative(path.dirname(from), to)
  if (!relativePath.startsWith('.') && !relativePath.startsWith('..')) {
    relativePath = './' + relativePath
  }
  return relativePath
}

export function getScriptEntries(
  compiler: Compiler,
  scriptPath: string | string[] | undefined,
  exclude: string[]
): string[] {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
    ? [scriptPath]
    : []

  const fileAssets = scriptEntries.filter((asset) => {
    const validFile =
      // File exists
      fs.existsSync(asset) &&
      // Not in some public/ folder
      !shouldExclude(asset, exclude)

    const validFileExtensions = compiler.options.resolve?.extensions || [
      '.js',
      '.mjs'
    ]
    const assetExtension = path.extname(asset)

    return validFile && validFileExtensions.includes(assetExtension)
  })

  return fileAssets
}

export function getCssEntries(
  scriptPath: string | string[] | undefined,
  exclude: string[]
): string[] {
  const scriptEntries = Array.isArray(scriptPath)
    ? scriptPath || []
    : scriptPath
    ? [scriptPath]
    : []

  const fileAssets = scriptEntries.filter((asset) => {
    const validFile =
      // File exists
      fs.existsSync(asset) &&
      // Not in some public/ folder
      !shouldExclude(asset, exclude)

    return (
      (validFile && asset.endsWith('.css')) ||
      asset.endsWith('.scss') ||
      asset.endsWith('.sass') ||
      asset.endsWith('.less')
    )
  })

  return fileAssets
}
