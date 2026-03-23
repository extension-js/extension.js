import * as path from 'path'
import * as fs from 'fs'
import packageJson from '../../package.json'
import {resolveOptionalDependencySpecs} from '../webpack-lib/optional-dependencies'

function parseJsonSafe(text: string | Buffer) {
  const raw = typeof text === 'string' ? text : String(text || '')
  const s = raw && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return JSON.parse(s || '{}')
}

function ensureOptionalInstallBaseDir(installBaseDir: string): void {
  fs.mkdirSync(installBaseDir, {recursive: true})

  const packageJsonPath = path.join(installBaseDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: `extensionjs-optional-deps-${packageJson.version}`,
          private: true,
          version: packageJson.version
        },
        null,
        2
      ) + '\n'
    )
  }
}

function removePathIfExists(targetPath: string): void {
  if (!fs.existsSync(targetPath)) return
  fs.rmSync(targetPath, {recursive: true, force: true})
}

function resetOptionalInstallRoot(installBaseDir: string): void {
  removePathIfExists(path.join(installBaseDir, 'node_modules'))
  removePathIfExists(path.join(installBaseDir, 'package-lock.json'))
  removePathIfExists(path.join(installBaseDir, 'npm-shrinkwrap.json'))
  removePathIfExists(path.join(installBaseDir, 'pnpm-lock.yaml'))
  removePathIfExists(path.join(installBaseDir, 'yarn.lock'))
  removePathIfExists(path.join(installBaseDir, 'bun.lock'))
}

function getPinnedOptionalDependencyMap(
  dependencies: string[]
): Record<string, string> {
  const specs = resolveOptionalDependencySpecs(dependencies)
  const pinned: Record<string, string> = {}

  for (let i = 0; i < dependencies.length; i++) {
    const dependencyId = dependencies[i]
    const spec = specs[i] || ''
    const versionSeparator = spec.lastIndexOf('@')

    if (!dependencyId || versionSeparator <= 0) continue
    pinned[dependencyId] = spec.slice(versionSeparator + 1)
  }

  return pinned
}

function ensureOptionalDependenciesManifest(
  installBaseDir: string,
  dependencies: string[]
): void {
  if (!dependencies.length) return
  const packageJsonPath = path.join(installBaseDir, 'package.json')
  const current = parseJsonSafe(fs.readFileSync(packageJsonPath, 'utf8'))
  const nextOptionalDependencies = {
    ...(current.optionalDependencies || {}),
    ...getPinnedOptionalDependencyMap(dependencies)
  }

  const didChange = dependencies.some(
    (dependencyId) =>
      current.optionalDependencies?.[dependencyId] !==
      nextOptionalDependencies[dependencyId]
  )

  if (!didChange) return
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(
      {
        ...current,
        private: true,
        optionalDependencies: nextOptionalDependencies
      },
      null,
      2
    ) + '\n'
  )
}

export function prepareOptionalInstallState(input: {
  installBaseDir: string
  dependencies: string[]
  forceRecreateInstallRoot?: boolean
}) {
  if (input.forceRecreateInstallRoot) {
    resetOptionalInstallRoot(input.installBaseDir)
  }
  ensureOptionalInstallBaseDir(input.installBaseDir)
  ensureOptionalDependenciesManifest(input.installBaseDir, input.dependencies)
}
