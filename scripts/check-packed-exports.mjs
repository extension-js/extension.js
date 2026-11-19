#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)

const toPosix = (value) => value.split(path.sep).join('/')

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32'
  })

  if (result.error) throw result.error

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status} in ${cwd}:\n${result.stderr}`
    )
  }

  return result.stdout
}

// The workspace file decides what a package of this repository is, so the
// package manager answers, and a private package is never published.
export function listPublishablePackages(root = repoRoot) {
  const listed = JSON.parse(
    run('pnpm', ['ls', '--recursive', '--depth', '-1', '--json'], root)
  )

  return listed
    .map(({path: dir}) => ({
      dir,
      manifest: JSON.parse(
        fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
      )
    }))
    .filter(({manifest}) => manifest.private !== true && manifest.name)
    .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))
}

function exportTargets(value, where, targets) {
  if (value === null || value === undefined) return

  if (typeof value === 'string') {
    targets.push({where, target: value})

    return
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      exportTargets(item, `${where}[${index}]`, targets)
    }

    return
  }

  for (const [key, item] of Object.entries(value)) {
    exportTargets(item, `${where}[${JSON.stringify(key)}]`, targets)
  }
}

// Every file the manifest names as an entry, under every condition. A resolver
// follows the first condition it knows, so each one has to lead to a file.
export function manifestTargets(manifest) {
  const targets = []

  exportTargets(manifest.exports, 'exports', targets)

  for (const field of ['main', 'module', 'types', 'typings']) {
    if (typeof manifest[field] === 'string') {
      targets.push({where: field, target: manifest[field]})
    }
  }

  if (typeof manifest.bin === 'string') {
    targets.push({where: 'bin', target: manifest.bin})
  } else if (manifest.bin && typeof manifest.bin === 'object') {
    exportTargets(manifest.bin, 'bin', targets)
  }

  return targets
}

function isShipped({where, target}, files) {
  const file = path.posix.normalize(target).replace(/^\.\//, '')

  // A pattern or a folder target ships when at least one file matches it.
  if (file.includes('*')) {
    const [prefix, suffix] = file.split('*')

    return [...files].some(
      (name) => name.startsWith(prefix) && name.endsWith(suffix)
    )
  }

  if (file.endsWith('/')) {
    return [...files].some((name) => name.startsWith(file))
  }

  if (files.has(file)) return true

  // Node completes "main" alone with an extension or an index file.
  return (
    where === 'main' &&
    [`${file}.js`, `${file}.json`, `${file}.node`, `${file}/index.js`].some(
      (name) => files.has(name)
    )
  )
}

export function missingTargets(manifest, files) {
  const shipped = new Set(files)

  return manifestTargets(manifest).filter((entry) => !isShipped(entry, shipped))
}

// npm publishes these packages, so npm says what the tarball holds. A dry run
// writes no file, and with scripts off it runs no code of the package.
export function packedFiles(dir) {
  const output = JSON.parse(
    run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], dir)
  )
  // Older npm prints a list, newer npm an object keyed by package name.
  const [packed] = Array.isArray(output) ? output : Object.values(output)

  return packed.files.map((file) => toPosix(file.path))
}

export function checkPackedExports(options = {}) {
  const root = options.root ?? repoRoot
  const packages =
    options.packages ??
    (options.dirs
      ? options.dirs.map((dir) => ({
          dir,
          manifest: JSON.parse(
            fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
          )
        }))
      : listPublishablePackages(root))
  const problems = []
  let targets = 0

  for (const {dir, manifest} of packages) {
    // npm publishes package.json as written. It reads no export override.
    const files = packedFiles(dir)

    targets += manifestTargets(manifest).length

    for (const {where, target} of missingTargets(manifest, files)) {
      problems.push(`${manifest.name}: ${where} names ${target}`)
    }
  }

  return {
    ok: problems.length === 0 && packages.length > 0,
    problems,
    targets,
    names: packages.map(({manifest}) => manifest.name)
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  // Arguments name package folders to check in place of the whole workspace.
  const dirs = process.argv.slice(2).map((dir) => path.resolve(dir))
  const result = checkPackedExports(dirs.length > 0 ? {dirs} : {})

  if (result.names.length === 0) {
    console.error('Found no publishable package to check.')
    process.exit(1)
  }

  if (!result.ok) {
    console.error(
      'These entries name a file the published tarball does not hold:'
    )

    for (const problem of result.problems) console.error(`  ${problem}`)

    console.error(
      'Ship the file through "files", or remove the entry from package.json.'
    )

    process.exit(1)
  }

  console.log(
    `Every entry is in its tarball: ${result.targets} targets in ${result.names.join(', ')}.`
  )
}
