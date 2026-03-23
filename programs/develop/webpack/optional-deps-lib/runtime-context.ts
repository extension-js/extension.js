import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import packageJson from '../../package.json'
import {findExtensionDevelopRoot} from '../webpack-lib/check-build-dependencies'

function parseJsonSafe(text: string | Buffer) {
  const raw = typeof text === 'string' ? text : String(text || '')
  const s = raw && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return JSON.parse(s || '{}')
}

function resolveDevelopRootFromDir(dir: string): string | undefined {
  try {
    const packageJsonPath = path.join(dir, 'package.json')
    if (!fs.existsSync(packageJsonPath)) return undefined
    const pkg = parseJsonSafe(fs.readFileSync(packageJsonPath, 'utf8'))
    if (pkg?.name === 'extension-develop') return dir
  } catch {
    return undefined
  }
  return undefined
}

function findDevelopRootFrom(startDir: string): string | undefined {
  let currentDir = startDir
  const maxDepth = 6

  for (let i = 0; i < maxDepth; i++) {
    const root = resolveDevelopRootFromDir(currentDir)
    if (root) return root

    const parent = path.dirname(currentDir)
    if (parent === currentDir) break
    currentDir = parent
  }

  return undefined
}

export function resolveDevelopInstallRoot(): string | undefined {
  const directRoot = findExtensionDevelopRoot()
  if (directRoot) return directRoot

  try {
    const candidateRoot = findDevelopRootFrom(__dirname)
    if (candidateRoot) return candidateRoot
  } catch {
    // ignore
  }

  try {
    const pkgPath = require.resolve('extension-develop/package.json', {
      paths: [__dirname]
    })
    return resolveDevelopRootFromDir(path.dirname(pkgPath))
  } catch {
    return undefined
  }
}

function getExtensionJsCacheBaseDir(): string {
  const override = process.env.EXTENSION_JS_CACHE_DIR
  if (override) return path.resolve(override)

  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'extensionjs')
  }

  if (process.env.XDG_CACHE_HOME) {
    return path.join(process.env.XDG_CACHE_HOME, 'extensionjs')
  }

  return path.join(os.homedir(), '.cache', 'extensionjs')
}

export function resolveOptionalInstallRoot(): string {
  return path.join(
    getExtensionJsCacheBaseDir(),
    'optional-deps',
    packageJson.version
  )
}

export function hasDependency(projectPath: string, dependency: string) {
  const findNearestPackageJsonDirectory = (
    startPath: string
  ): string | undefined => {
    let currentDirectory = startPath
    const maxDepth = 4

    for (let i = 0; i < maxDepth; i++) {
      const candidate = path.join(currentDirectory, 'package.json')
      if (fs.existsSync(candidate)) return currentDirectory

      const parentDirectory = path.dirname(currentDirectory)
      if (parentDirectory === currentDirectory) break
      currentDirectory = parentDirectory
    }
    return undefined
  }

  const packageJsonDirectory = findNearestPackageJsonDirectory(projectPath)
  if (!packageJsonDirectory) return false

  const packageJsonPath = path.join(packageJsonDirectory, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return false

  const parsed = parseJsonSafe(fs.readFileSync(packageJsonPath, 'utf8'))
  const dependencies = parsed.dependencies || {}
  const devDependencies = parsed.devDependencies || {}
  return !!dependencies[dependency] || !!devDependencies[dependency]
}
