import * as path from 'path'
import * as fs from 'fs'
import {findExtensionDevelopRoot} from './check-build-dependencies'
import packageJson from '../../package.json'

if (!process.env.EXTENSION_JS_OPTIONAL_DEPS_VERSION) {
  process.env.EXTENSION_JS_OPTIONAL_DEPS_VERSION = packageJson.version
}

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
  const envRoot = process.env.EXTENSION_DEVELOP_ROOT

  if (envRoot) {
    const resolvedEnvRoot = resolveDevelopRootFromDir(path.resolve(envRoot))
    if (resolvedEnvRoot) return resolvedEnvRoot
  }

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

export function resolveDevelopDistFile(stem: string): string {
  const installRoot = resolveDevelopInstallRoot()
  const distRoot = installRoot
    ? path.join(installRoot, 'dist')
    : path.resolve(__dirname, '..')
  const base = path.join(distRoot, stem)
  const candidates = [`${base}.js`, `${base}.cjs`, `${base}.mjs`, base]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      if (process.env.EXTENSION_DEBUG_DEVELOP_ROOT === '1') {
        console.log(
          `[extjs:develop-root] ${stem} -> ${candidate} (installRoot=${installRoot || '<none>'})`
        )
      }

      return candidate
    }
  }

  if (process.env.EXTENSION_DEBUG_DEVELOP_ROOT === '1') {
    console.log(
      `[extjs:develop-root] ${stem} -> ${base} (fallback, installRoot=${installRoot || '<none>'})`
    )
  }

  return base
}
