// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

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

const run = async () => {
  const compileCode = await runCommand('pnpm', ['run', 'compile'])

  if (compileCode !== 0) {
    return compileCode
  }

  return runCommand('dotenv', [
    '--',
    'turbo',
    'run',
    'watch',
    '--filter',
    './programs/*',
    '--concurrency=5'
  ])
}

try {
  const exitCode = await run()
  process.exit(exitCode)
} catch (error) {
  console.error(error)
  process.exit(1)
}
