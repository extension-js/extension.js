// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import path from 'node:path'
import {fileURLToPath} from 'node:url'
import spawn from 'cross-spawn'
import {withRepoBin} from './lib/repo-bin-env.mjs'

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: withRepoBin(),
      ...options
    })

    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })

// Only a runner that never started earns the fallback: a turbo compile that
// failed used to build every package a second time and print each error twice.
export async function runCompile(run = runCommand) {
  try {
    return await run('dotenv', ['--', 'turbo', 'run', 'compile'])
  } catch {
    return run('pnpm', ['-r', '--filter', './programs/*', 'run', 'compile'])
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exit(await runCompile())
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}
