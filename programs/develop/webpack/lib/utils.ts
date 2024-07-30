import path from 'path'
import fs from 'fs'
import {type Compilation} from 'webpack'
import {execSync} from 'child_process'
import {detect} from 'detect-package-manager'
import * as messages from './messages'
import {type Manifest} from '../types'

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

export function isFromFilepathList(
  filePath: string,
  filepathList?: Record<string, string | string[] | undefined>
): boolean {
  return Object.values(filepathList || {}).some((value) => {
    return value === filePath
  })
}

export function getFilename(
  feature: string,
  filepath: string,
  exclude: string[]
) {
  const entryExt = path.extname(filepath)

  // Do not attempt to rewrite the asset path if it's in the exclude list.
  const shouldSkipRewrite = shouldExclude(filepath, {exclude})

  let fileOutputpath = shouldSkipRewrite ? path.normalize(filepath) : feature

  if (['.js', '.jsx', '.tsx', '.ts'].includes(entryExt)) {
    fileOutputpath = fileOutputpath.replace(entryExt, '.js')
  }

  if (['.html', '.njk', '.nunjucks'].includes(entryExt)) {
    fileOutputpath = fileOutputpath.replace(entryExt, '.html')
  }

  if (['.css', '.scss', '.sass', '.less'].includes(entryExt)) {
    fileOutputpath = fileOutputpath.replace(entryExt, '.css')
  }

  return unixify(fileOutputpath || '')
}

/**
 * Change the path from win style to unix style
 */
export function unixify(filepath: string) {
  return filepath.replace(/\\/g, '/')
}

export function shouldExclude(
  path: string,
  ignorePatterns?: Record<string, string | string[] | undefined>
): boolean {
  if (!ignorePatterns) {
    return false
  }

  const patterns = Array.isArray(ignorePatterns)
    ? ignorePatterns
    : [ignorePatterns]

  return patterns.some((pattern) => {
    if (typeof pattern !== 'string') {
      return false
    }

    const _pattern = unixify(pattern)
    return path.includes(
      _pattern.startsWith('/') ? _pattern.slice(1) : _pattern
    )
  })
}

export function getManifestContent(
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

export function getRelativePath(from: string, to: string) {
  let relativePath = path.relative(path.dirname(from), to)
  if (!relativePath.startsWith('.') && !relativePath.startsWith('..')) {
    relativePath = './' + relativePath
  }
  return relativePath
}

export async function installOptionalDependencies(
  feature: string,
  dependencies: string[]
) {
  try {
    const pm = await detect()
    console.log(messages.featureNotInstalled(feature, pm))

    let installCommand = ''
    if (pm === 'yarn') {
      installCommand = `yarn --silent add ${dependencies.join(
        ' '
      )} --cwd ${__dirname} --optional`
    } else if (pm === 'npm') {
      installCommand = `npm  --silent install ${dependencies.join(
        ' '
      )} --prefix ${__dirname} --save-optional`
    } else if (pm === 'pnpm') {
      installCommand = `pnpm  --silent add ${dependencies.join(
        ' '
      )} --prefix ${__dirname} --save-optional`
    } else {
      installCommand = `${pm} --silent install ${dependencies.join(
        ' '
      )} --cwd ${__dirname} --optional`
    }

    execSync(installCommand, {stdio: 'inherit'})

    // Adding a delay to ensure the modules are installed and available
    await new Promise((resolve) => setTimeout(resolve, 2000))

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.installingRootDependencies())

      if (pm === 'yarn') {
        installCommand = `yarn install --silent > /dev/null 2>&1`
      } else if (pm === 'npm') {
        installCommand = `npm install --silent > /dev/null 2>&1`
      } else if (pm === 'pnpm') {
        installCommand = `pnpm install --silent > /dev/null 2>&1`
      } else {
        installCommand = `${pm} install --silent > /dev/null 2>&1`
      }

      execSync(installCommand, {stdio: 'inherit'})
    }

    console.log(messages.featureInstalledSuccessfully(feature))
  } catch (error) {
    console.error(messages.failedToinstallFeature(error))
  }
}

export function isUsingJSFramework(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

  const frameworks = [
    'react',
    'vue',
    '@angular/core',
    'svelte',
    'solid-js',
    'preact'
  ]

  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  for (const framework of frameworks) {
    if (dependencies[framework] || devDependencies[framework]) {
      return true
    }
  }

  return false
}
