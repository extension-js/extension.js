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

  return reactAsDevDep || reactAsDep
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
  const relativePath = path.relative(context, filePath)
  const pathNormalized = path.normalize(relativePath)
  const publicPath = pathNormalized.split(`${basePath}/`)[1]
  return `/${basePath}/${publicPath}`
}

export function isCompilationEntry(compilation: Compilation, filePath: string) {
  const context = compilation.compiler.context
  const filePathAbsolute = path.resolve(context, filePath)
  const assets = Object.keys(compilation.assets)

  console.log({assets, filePathAbsolute})
  return false
}

export function getCompilationEntryName(
  compilation: Compilation,
  filePath: string
) {
  const context = compilation.compiler.context
  const filePathAbsolute = path.resolve(context, filePath)
  const assets = Object.keys(compilation.assets)

  console.log({filePathAbsolute, assets2: assets})

  return ''
}
