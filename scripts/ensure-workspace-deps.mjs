#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {realpathSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import spawn from 'cross-spawn'
import {
  unbuiltDependencyLine,
  unbuiltWorkspaceDependencies
} from './lib/workspace-build-entries.mjs'

/** @param {string} dir */
function runCompile(dir) {
  const child = spawn.sync('pnpm', ['-C', dir, 'run', 'compile'], {
    stdio: 'inherit'
  })

  return child.status ?? 1
}

function main() {
  const packageDir = path.resolve(process.cwd(), process.argv[2] ?? '.')

  for (const dependency of unbuiltWorkspaceDependencies(packageDir)) {
    const {name} = dependency

    if (!dependency.linked) {
      console.error(`error: ${unbuiltDependencyLine(dependency)}`)

      process.exit(1)
    }

    if (!dependency.canCompile) {
      console.error(
        `error: workspace dependency ${name} has no build output (${dependency.missing[0]}) and no compile script.`
      )

      process.exit(1)
    }

    const relativeDir = path.relative(process.cwd(), dependency.dir) || '.'

    console.log(
      `Building workspace dependency ${name}, its ${dependency.missing[0]} is missing.`
    )

    if (runCompile(dependency.dir) !== 0) {
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
