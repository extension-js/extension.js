import path from 'path'
import fs from 'fs'
import {type Compilation} from 'webpack'
import {type IncludeList, type Manifest} from '../types'

function isUsingReact(projectDir: string) {
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

function shouldExclude(path: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => {
    return path.includes(pattern)
  })
}

function getResolvedPath(context: string, filePath: string, basePath: string) {
  // Ensure the filePath is relative to the context
  const relativePath = path.relative(context, filePath)

  // Normalize to avoid issues with different OS path formats
  const pathNormalized = path.normalize(relativePath)
  const prefixedBasePath = basePath ? `/${basePath}` : ''
  const publicPath = path.join(prefixedBasePath, pathNormalized)

  return path.normalize(publicPath)
}

function isFromIncludeList(
  includeList: IncludeList,
  filePath: string
): boolean {
  return Object.values(includeList).some((value) => {
    return value?.html === filePath
  })
}

function getIncludeEntry(
  includeList: IncludeList,
  filePath: string,
  extension: string
): string {
  const entryname =
    Object.keys(includeList).find((key) => {
      return (
        includeList[key]?.html === filePath ||
        includeList[key]?.js.includes(filePath) ||
        includeList[key]?.css.includes(filePath)
      )
    }) || ''

  const extname = getExtname(filePath)
  if (!entryname) return `${filePath.replace(extname, '')}${extension}`

  return `/${entryname.replace(extname, '')}${extension}`
}

function getExtname(filePath: string) {
  const extname = path.extname(filePath)

  switch (extname) {
    case '.js':
    case '.mjs':
    case '.ts':
    case '.tsx':
      return '.js'
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return '.css'
    case '.html':
      return '.html'
    default:
      return '.js'
  }
}

function getManifestContent(
  compilation: Compilation,
  manifestPath: string
): Manifest {
  if (
    compilation.getAsset('manifest.json') ||
    compilation.assets['manifest.json']
  ) {
    const manifest = compilation.assets['manifest.json'].source().toString()
    return JSON.parse(manifest || '{}')
  }

  return require(manifestPath)
}

export {
  isUsingReact,
  shouldExclude,
  getResolvedPath,
  isFromIncludeList,
  getIncludeEntry,
  getExtname,
  getManifestContent
}
