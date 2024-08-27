import path from 'path'
import fs from 'fs'
import {type Compilation} from 'webpack'
import {execSync} from 'child_process'
import {detect} from 'detect-package-manager'
import * as messages from './messages'
import {type Manifest, type FilepathList} from '../webpack-types'
import {CHROMIUM_BASED_BROWSERS} from './constants'
import {DevOptions} from '../../module'

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
  filepathList?: FilepathList
): boolean {
  return Object.values(filepathList || {}).some((value) => {
    return value === filePath
  })
}

export function getFilename(
  feature: string,
  filePath: string,
  excludeList: FilepathList
) {
  const entryExt = path.extname(filePath)

  // Do not attempt to rewrite the asset path if it's in the exclude list.
  const skipPathResolve = shouldExclude(filePath, excludeList)

  let fileOutputpath = skipPathResolve ? path.normalize(filePath) : feature

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
export function unixify(filePath: string) {
  return filePath.replace(/\\/g, '/')
}

export function shouldExclude(
  filePath: string,
  ignorePatterns: FilepathList = {}
): boolean {
  if (!ignorePatterns) {
    return false
  }

  const unixifiedFilePath = unixify(filePath)

  const isFilePathInExcludedList = Object.values(ignorePatterns).some(
    (pattern) => {
      if (typeof pattern !== 'string') {
        return false
      }

      const _pattern = unixify(pattern).replace(/\/$/, '')

      return unixifiedFilePath.includes(_pattern)
    }
  )

  return isFilePathInExcludedList
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
  packageName: string,
  integration: string,
  dependencies: string[]
) {
  try {
    const pm = await detect()
    console.log(messages.integrationNotInstalled(packageName, integration, pm))

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
      console.log(messages.installingRootDependencies(packageName, integration))

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

    console.log(
      messages.integrationInstalledSuccessfully(packageName, integration)
    )
  } catch (error) {
    console.error(
      messages.failedToInstallIntegration(packageName, integration, error)
    )
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

export function isFirstRun(browser: string) {
  return !fs.existsSync(path.resolve(__dirname, `run-${browser}-profile`))
}

export function getHardcodedMessage(manifest: Manifest): {
  data: messages.MessageData
} {
  const manifestName = manifest.name?.replace(/ /g, '-').toLowerCase()

  return {
    data: {
      id: `${manifestName}@extension-js`,
      manifest,
      management: {
        id: `${manifestName}@extension-js`,
        mayDisable: true,
        optionsUrl: '',
        installType: 'development' as 'development',
        type: 'extension' as 'extension',
        enabled: true,
        name: manifest.name || '',
        description: manifest.description || '',
        version: manifest.version || '',
        hostPermissions: manifest.host_permissions || [],
        permissions: manifest.permissions || [],
        offlineEnabled: manifest.offline_enabled || false,
        shortName: manifest.short_name || '',
        isApp:
          manifest.app &&
          manifest.app.background &&
          manifest.app.background.scripts
      }
    }
  }
}

export function removeManifestKeysNotFromCurrentBrowser(
  manifest: Manifest,
  browser: DevOptions['browser']
) {
  const patchedManifest = JSON.parse(
    JSON.stringify(manifest),
    function reviver(this: any, key: string, value: any) {
      const indexOfColon = key.indexOf(':')

      // Retain plain keys.
      if (indexOfColon === -1) {
        return value
      }

      // Replace browser:key keys.
      const prefix = key.substring(0, indexOfColon)

      if (
        prefix === browser ||
        (prefix === 'chromium' && CHROMIUM_BASED_BROWSERS.includes(browser))
      ) {
        this[key.substring(indexOfColon + 1)] = value
      }

      // Implicitly delete the key otherwise.
    }
  )

  return patchedManifest
}
