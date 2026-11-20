// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {keepVitestFilters} from './lib/vitest-filter-args.mjs'

// `pnpm test -- <file>` and `pnpm test -u <file>` both lose the filter in
// vitest, which then runs the suite. Both are rewritten so the filter holds.
export function vitestArgs(argv) {
  return ['run', ...keepVitestFilters(argv)]
}

function resolveVitestPackage(cwd) {
  return createRequire(path.join(cwd, 'package.json')).resolve(
    'vitest/package.json'
  )
}

export function resolveVitestBin(cwd = process.cwd()) {
  const pkgPath = resolveVitestPackage(cwd)
  const bin = createRequire(pkgPath)(pkgPath).bin
  const rel = typeof bin === 'string' ? bin : bin.vitest

  return path.resolve(path.dirname(pkgPath), rel)
}

// The pnpm shim puts the store's hoisted folder on NODE_PATH, and specs that
// resolve undeclared packages such as sass rely on it under the isolated linker.
export function vitestEnv(vitestPkgPath, env = process.env) {
  const marker = `${path.sep}node_modules${path.sep}.pnpm${path.sep}`
  const at = vitestPkgPath.lastIndexOf(marker)

  if (at === -1) return env

  const hoisted = path.join(
    vitestPkgPath.slice(0, at + marker.length),
    'node_modules'
  )
  const nodePath = env.NODE_PATH
    ? `${hoisted}${path.delimiter}${env.NODE_PATH}`
    : hoisted

  return {...env, NODE_PATH: nodePath}
}

export function runVitest(argv = process.argv.slice(2)) {
  const result = spawnSync(
    process.execPath,
    [resolveVitestBin(), ...vitestArgs(argv)],
    {stdio: 'inherit', env: vitestEnv(resolveVitestPackage(process.cwd()))}
  )

  if (result.error) throw result.error
  if (result.signal) process.kill(process.pid, result.signal)

  return result.status ?? 1
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(runVitest())
}
