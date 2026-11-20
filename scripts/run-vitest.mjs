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

// `pnpm test -- <file>` hands vitest a bare `--`, and vitest files everything
// after it as unknown options, so the filter is dropped and the suite runs.
export function vitestArgs(argv) {
  return ['run', ...argv.filter((arg) => arg !== '--')]
}

export function resolveVitestBin(cwd = process.cwd()) {
  const require = createRequire(path.join(cwd, 'package.json'))
  const pkgPath = require.resolve('vitest/package.json')
  const bin = require(pkgPath).bin
  const rel = typeof bin === 'string' ? bin : bin.vitest

  return path.resolve(path.dirname(pkgPath), rel)
}

export function runVitest(argv = process.argv.slice(2)) {
  const result = spawnSync(
    process.execPath,
    [resolveVitestBin(), ...vitestArgs(argv)],
    {stdio: 'inherit', env: process.env}
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
