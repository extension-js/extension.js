import {existsSync, readFileSync, realpathSync} from 'node:fs'
import path from 'node:path'

/**
 * @typedef {object} PackageManifest
 * @property {string} [name]
 * @property {unknown} [main]
 * @property {unknown} [types]
 * @property {unknown} [exports]
 * @property {Record<string, unknown>} [scripts]
 * @property {Record<string, unknown>} [dependencies]
 * @property {Record<string, unknown>} [devDependencies]
 * @property {Record<string, unknown>} [optionalDependencies]
 */

/** @param {PackageManifest} manifest */
export function workspaceDependencyNames(manifest) {
  const fields = [
    manifest?.dependencies,
    manifest?.devDependencies,
    manifest?.optionalDependencies
  ]
  const names = new Set()

  for (const field of fields) {
    for (const [name, range] of Object.entries(field ?? {})) {
      if (typeof range === 'string' && range.startsWith('workspace:')) {
        names.add(name)
      }
    }
  }

  return [...names]
}

/**
 * @param {PackageManifest} manifest
 * @returns {string[]}
 */
export function buildEntriesFor(manifest) {
  const entries = new Set()

  // A subpath pattern such as ./dist/contract/* never exists as a file, so the
  // folder that holds its matches is what tells us the package was built.
  const add = (/** @type {unknown} */ value) => {
    if (typeof value !== 'string' || !value.startsWith('.')) return

    entries.add(
      value.includes('*')
        ? value.slice(0, value.indexOf('*')).replace(/\/$/, '')
        : value
    )
  }

  add(manifest?.main)
  add(manifest?.types)

  const collect = (/** @type {unknown} */ node) => {
    if (typeof node === 'string') return add(node)
    if (!node || typeof node !== 'object') return

    for (const value of Object.values(node)) collect(value)
  }

  collect(manifest?.exports)

  return [...entries]
}

/** @param {{manifest: PackageManifest, exists: (entry: string) => boolean}} input */
export function missingBuildEntries({manifest, exists}) {
  return buildEntriesFor(manifest).filter((entry) => !exists(entry))
}

/**
 * @param {string} dir
 * @returns {PackageManifest}
 */
function readManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'))
}

// Each workspace dependency of the package that cannot be loaded as it is:
// not linked by an install, or linked with a build entry that is not there.
/**
 * @typedef {{name: string, owner: string, linked: boolean, dir: string, missing: string[], canCompile: boolean}} UnbuiltDependency
 * @param {string} packageDir
 * @returns {UnbuiltDependency[]}
 */
export function unbuiltWorkspaceDependencies(packageDir) {
  const manifest = readManifest(packageDir)
  /** @type {UnbuiltDependency[]} */
  const unbuilt = []

  for (const name of workspaceDependencyNames(manifest)) {
    const linked = path.join(packageDir, 'node_modules', name)

    if (!existsSync(linked)) {
      unbuilt.push({
        name,
        owner: String(manifest.name),
        linked: false,
        dir: '',
        missing: [],
        canCompile: false
      })

      continue
    }

    const dir = realpathSync(linked)
    const depManifest = readManifest(dir)
    const missing = missingBuildEntries({
      manifest: depManifest,
      exists: (entry) => existsSync(path.join(dir, entry))
    })

    if (missing.length === 0) continue

    unbuilt.push({
      name,
      owner: String(manifest.name),
      linked: true,
      dir,
      missing,
      canCompile: Boolean(depManifest.scripts?.compile)
    })
  }

  return unbuilt
}

// One line for a run that cannot build the dependency itself, with the
// command that does.
/**
 * @param {UnbuiltDependency} dependency
 * @param {string} [cwd]
 */
export function unbuiltDependencyLine(dependency, cwd = process.cwd()) {
  if (!dependency.linked) {
    return `workspace dependency ${dependency.name} of ${dependency.owner} is not linked. Run "pnpm install" from the repository root.`
  }

  const relativeDir =
    path.relative(cwd, dependency.dir).split(path.sep).join('/') || '.'

  return `workspace dependency ${dependency.name} has no build output (${dependency.missing[0]}). Run "pnpm -C ${relativeDir} run compile" first.`
}
