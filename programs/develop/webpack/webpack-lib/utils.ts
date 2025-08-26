import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as crypto from 'crypto'
import {type Compilation} from '@rspack/core'
import {execSync} from 'child_process'
import {detect} from 'package-manager-detector'
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

  // If excluded and the excluded path comes from a special folder mapping
  // (e.g., public/), derive the output from the mapping key so manifest paths
  // match where SpecialFolders are copied to at build time.
  if (skipPathResolve) {
    const matched = Object.entries(excludeList || {}).find(([, value]) => {
      if (Array.isArray(value)) return value.includes(filePath)
      return value === filePath
    })

    const matchedKey = matched?.[0]
    if (matchedKey && typeof matchedKey === 'string') {
      const unixKey = unixify(matchedKey)
      // Only remap when the mapping key represents a public/ path
      if (/^(?:\.\/)?public\//i.test(unixKey)) {
        fileOutputpath = unixKey.replace(/^(?:\.\/)?public\//i, '')
      } else if (/^\/public\//i.test(unixKey)) {
        fileOutputpath = unixKey.replace(/^\/public\//i, '')
      } else if (/^\//.test(unixKey)) {
        // Root-relative (implicit public root)
        fileOutputpath = unixKey.replace(/^\//, '')
      } else {
        // Keep original normalized file path for non-public mapping keys
        fileOutputpath = path.normalize(filePath)
      }
    }
  }

  // Not excluded by value; try to derive from mapping keys when the manifest
  // provided a public-root style path and we have a matching entry from
  // SpecialFolders. This accounts for different authoring forms:
  // 'public/foo', './public/foo', '/public/foo', or '/foo'.
  if (!skipPathResolve && excludeList) {
    const keys = Object.keys(excludeList)
    const unixInput = unixify(filePath)

    // First try exact key match
    let matchKey = keys.find((k) => unixify(k) === unixInput)

    // If not found, try a normalized public-root equivalence match
    if (!matchKey) {
      const stripPublicPrefix = (p: string) =>
        unixify(p)
          .replace(/^\/(?:public\/)?/i, '') // '/public/foo' or '/foo' -> 'foo'
          .replace(/^(?:\.\/)?public\//i, '') // 'public/foo' or './public/foo' -> 'foo'

      const inputStripped = stripPublicPrefix(unixInput)
      matchKey = keys.find((k) => stripPublicPrefix(k) === inputStripped)
    }

    if (matchKey) {
      const unixKey = unixify(matchKey)
      if (/^(?:\.\/)?public\//i.test(unixKey)) {
        fileOutputpath = unixKey.replace(/^(?:\.\/)?public\//i, '')
      } else if (/^\/public\//i.test(unixKey)) {
        fileOutputpath = unixKey.replace(/^\/public\//i, '')
      } else {
        fileOutputpath = unixKey
      }
    }
  }

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

  const unixifiedFilePath = path.normalize(unixify(filePath))
  const isFilePathInExcludedList = Object.values(ignorePatterns).some(
    (pattern) => {
      const matchOne = (candidate: string) => {
        if (!candidate || typeof candidate !== 'string') return false
        const normalizedCandidate = path.normalize(unixify(candidate))
        // Consider a match if the file path is exactly the same or contained under the candidate path
        return (
          unixifiedFilePath === normalizedCandidate ||
          unixifiedFilePath.startsWith(normalizedCandidate)
        )
      }

      if (Array.isArray(pattern)) {
        return pattern.some((p) => matchOne(p as any))
      }

      return matchOne(pattern as any)
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

export function isFromPnpx() {
  if (process.env.npm_config_user_agent) {
    if (process.env.npm_config_user_agent.includes('pnpm')) {
      return 'pnpm'
    }
  }

  return false
}

export function isFromNpx() {
  if (process.env['npm_execpath']) {
    return 'npm'
  }

  return false
}

export async function installOptionalDependencies(
  integration: string,
  dependencies: string[]
) {
  try {
    const pm = await detect()

    console.log(
      messages.integrationNotInstalled(integration, pm?.name || 'unknown')
    )

    let installCommand = ''
    if (pm?.name === 'yarn') {
      installCommand = `yarn --silent add ${dependencies.join(
        ' '
      )} --cwd ${__dirname} --optional`
    } else if (pm?.name === 'npm' || isFromNpx()) {
      installCommand = `npm  --silent install ${dependencies.join(
        ' '
      )} --prefix ${__dirname} --save-optional`
    } else if (isFromPnpx()) {
      installCommand = `pnpm --silent add ${dependencies.join(
        ' '
      )} --prefix ${__dirname} --save-optional`
    } else {
      installCommand = `${pm} --silent install ${dependencies.join(
        ' '
      )} --cwd ${__dirname} --optional`
    }

    execSync(installCommand, {stdio: 'inherit'})

    // Adding a minimal delay to ensure the modules are installed and available (optimized from 2s to 500ms)
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (process.env.EXTENSION_ENV === 'development') {
      console.log(messages.installingRootDependencies(integration))

      if (pm?.name === 'yarn') {
        installCommand = `yarn install --silent > /dev/null 2>&1`
      } else if (pm?.name === 'npm' || isFromNpx()) {
        installCommand = `npm install --silent > /dev/null 2>&1`
      } else if (isFromPnpx()) {
        installCommand = `pnpm install --silent > /dev/null 2>&1`
      } else {
        installCommand = `${pm} install --silent > /dev/null 2>&1`
      }

      execSync(installCommand, {stdio: 'inherit'})
    }

    console.log(messages.integrationInstalledSuccessfully(integration))
  } catch (error) {
    console.error(messages.failedToInstallIntegration(integration, error))
  }
}

export function isUsingJSFramework(projectPath: string): boolean {
  const frameworks = [
    'react',
    'vue',
    '@angular/core',
    'svelte',
    'solid-js',
    'preact'
  ]

  return frameworks.some((framework) => hasDependency(projectPath, framework))
}

export function isFirstRun(outputPath: string, browser: DevOptions['browser']) {
  const distPath = path.dirname(outputPath)
  return !fs.existsSync(
    path.resolve(distPath, 'extension-js', 'profiles', `${browser}-profile`)
  )
}

function getDataDirectory(): string {
  const platform = process.platform
  const isWSL = process.env.WSL_DISTRO_NAME || process.env.WSLENV

  switch (platform) {
    case 'darwin':
      return path.join(
        os.homedir(),
        'Library',
        'Application Support',
        'extension-js'
      )
    case 'win32':
      return path.join(process.env.APPDATA || '', 'extension-js')
    case 'linux':
      if (isWSL) {
        const windowsAppData = process.env.APPDATA
        if (windowsAppData) return path.join(windowsAppData, 'extension-js')
      }
      return path.join(os.homedir(), '.config', 'extension-js')
    default:
      return path.join(os.homedir(), '.extension-js')
  }
}

function getFirstRunFlagsDir(): string {
  return path.join(getDataDirectory(), 'first-run')
}

function hashProject(projectPath: string): string {
  try {
    return crypto
      .createHash('sha1')
      .update(projectPath)
      .digest('hex')
      .slice(0, 12)
  } catch {
    return Buffer.from(projectPath).toString('hex').slice(0, 12)
  }
}

function getFirstRunFlagPath(
  projectPath: string,
  browser: DevOptions['browser']
): string {
  const dir = getFirstRunFlagsDir()
  const key = `${hashProject(projectPath)}-${browser}.flag`
  return path.join(dir, key)
}

export function hasShownFirstRunMessage(
  projectPath: string,
  browser: DevOptions['browser']
): boolean {
  try {
    const flagPath = getFirstRunFlagPath(projectPath, browser)
    return fs.existsSync(flagPath)
  } catch {
    return false
  }
}

export function markFirstRunMessageShown(
  projectPath: string,
  browser: DevOptions['browser']
): void {
  try {
    const dir = getFirstRunFlagsDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true})
    const flagPath = getFirstRunFlagPath(projectPath, browser)
    fs.writeFileSync(flagPath, '1', 'utf8')
  } catch {
    // Non-fatal; ignore persistence failure
  }
}

export function shouldShowFirstRun(
  outputPath: string,
  browser: DevOptions['browser'],
  projectPath: string
): boolean {
  const firstByProfile = isFirstRun(outputPath, browser)
  if (!firstByProfile) return false
  return !hasShownFirstRunMessage(projectPath, browser)
}

export function filterKeysForThisBrowser(
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
        (prefix === 'chromium' && CHROMIUM_BASED_BROWSERS.includes(browser)) ||
        (prefix === 'chromium' && browser.includes('chromium')) ||
        (prefix === 'gecko' && browser.includes('gecko'))
      ) {
        this[key.substring(indexOfColon + 1)] = value
      }

      // Implicitly delete the key otherwise.
    }
  )

  return patchedManifest
}

export function hasDependency(projectPath: string, dependency: string) {
  const packageJsonPath = path.join(projectPath, 'package.json')

  if (!fs.existsSync(packageJsonPath)) {
    return false
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  return !!dependencies[dependency] || !!devDependencies[dependency]
}
