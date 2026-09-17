// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {existsSync, readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..'
)

export function repoCliPath(root = repoRoot) {
  return join(root, 'programs', 'extension', 'dist', 'cli.cjs')
}

// The repo build is the CLI a smoke means when it says "local": refusing a
// missing build beats silently running whatever `extension` is on PATH.
export function resolveRepoCli(root = repoRoot) {
  const cliPath = repoCliPath(root)

  if (!existsSync(cliPath)) {
    throw new Error(
      `The repo CLI is not built at ${cliPath}. Run \`pnpm compile\` first.`
    )
  }

  return {cliPath, source: 'repo build'}
}

// Read the bin the installed package itself declares, so this runs the same
// entry point the `node_modules/.bin` shim would, without the Windows .cmd shim.
export function resolveInstalledCli(projectDir) {
  const packageDir = join(projectDir, 'node_modules', 'extension')
  const packageJsonPath = join(packageDir, 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error(
      `The project has no installed extension CLI at ${packageDir}. ` +
        'Without it `extension` resolves off PATH, so this smoke would ' +
        'validate whichever CLI happens to be installed globally.'
    )
  }

  const installed = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
  const declaredBin =
    typeof installed?.bin === 'string'
      ? installed.bin
      : installed?.bin?.extension

  if (!declaredBin) {
    throw new Error(
      `Installed extension package declares no bin: ${packageJsonPath}`
    )
  }

  const cliPath = join(packageDir, declaredBin)

  if (!existsSync(cliPath)) {
    throw new Error(`Installed extension bin is missing: ${cliPath}`)
  }

  return {
    cliPath,
    source: `project node_modules (${installed.version})`
  }
}

export function resolveDevCli({projectDir, useRepoBuild = false, root}) {
  if (useRepoBuild) return resolveRepoCli(root)

  return resolveInstalledCli(projectDir)
}

// Every smoke spawns the CLI the same way: the current node binary, the
// resolved cli.cjs, no shell, so PATH and .cmd shims never get a say.
export function cliSpawnArgs(cli, args) {
  return [process.execPath, [cli.cliPath, ...args]]
}

export function describeDevCli(cli) {
  return `${cli.source} (${cli.cliPath})`
}
