#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {existsSync, readFileSync, realpathSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import spawn from 'cross-spawn'

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

export function buildEntriesFor(manifest) {
  const entries = new Set()

  // A subpath pattern such as ./dist/contract/* never exists as a file, so the
  // folder that holds its matches is what tells us the package was built.
  const add = (value) => {
    if (typeof value !== 'string' || !value.startsWith('.')) return

    entries.add(
      value.includes('*')
        ? value.slice(0, value.indexOf('*')).replace(/\/$/, '')
        : value
    )
  }

  add(manifest?.main)
  add(manifest?.types)

  const collect = (node) => {
    if (typeof node === 'string') return add(node)
    if (!node || typeof node !== 'object') return

    for (const value of Object.values(node)) collect(value)
  }

  collect(manifest?.exports)

  return [...entries]
}

export function missingBuildEntries({manifest, exists}) {
  return buildEntriesFor(manifest).filter((entry) => !exists(entry))
}

function readManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'))
}

function runCompile(dir) {
  const child = spawn.sync('pnpm', ['-C', dir, 'run', 'compile'], {
    stdio: 'inherit'
  })

  return child.status ?? 1
}

function main() {
  const packageDir = path.resolve(process.cwd(), process.argv[2] ?? '.')
  const manifest = readManifest(packageDir)
  const names = workspaceDependencyNames(manifest)

  for (const name of names) {
    const linked = path.join(packageDir, 'node_modules', name)

    if (!existsSync(linked)) {
      console.error(
        `error: workspace dependency ${name} of ${manifest.name} is not linked. Run "pnpm install" from the repository root.`
      )

      process.exit(1)
    }

    const depDir = realpathSync(linked)
    const depManifest = readManifest(depDir)
    const missing = missingBuildEntries({
      manifest: depManifest,
      exists: (entry) => existsSync(path.join(depDir, entry))
    })

    if (missing.length === 0) continue

    if (!depManifest.scripts?.compile) {
      console.error(
        `error: workspace dependency ${name} has no build output (${missing[0]}) and no compile script.`
      )

      process.exit(1)
    }

    const relativeDir = path.relative(process.cwd(), depDir) || '.'

    console.log(
      `Building workspace dependency ${name}, its ${missing[0]} is missing.`
    )

    if (runCompile(depDir) !== 0) {
      console.error(
        `error: could not build ${name}. Run "pnpm -C ${relativeDir} run compile" and read the failure there.`
      )

      process.exit(1)
    }
  }

  process.exit(0)
}

const invokedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main()
}
