import spawn from 'cross-spawn'

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options
    })

    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })

const getTurboFilters = (target) => {
  switch (target) {
    case 'cli':
      return ['--filter', './programs/cli']
    case 'develop':
    case 'build':
    case 'dev':
      return ['--filter', './programs/develop']
    default:
      return ['--filter', './programs/cli', '--filter', './programs/develop']
  }
}

const runFallbackTests = async (target) => {
  if (target === 'cli') {
    return runCommand('pnpm', ['-C', 'programs/cli', 'test'])
  }
  if (target === 'develop' || target === 'build' || target === 'dev') {
    return runCommand('pnpm', ['-C', 'programs/develop', 'test'])
  }

  const cliCode = await runCommand('pnpm', ['-C', 'programs/cli', 'test'])
  if (cliCode !== 0) {
    return cliCode
  }

  return runCommand('pnpm', ['-C', 'programs/develop', 'test'])
}

const run = async () => {
  const target = process.argv[2] ?? 'all'
  const turboFilters = getTurboFilters(target)

  const primaryCode = await runCommand('dotenv', [
    '--',
    'turbo',
    'run',
    'test',
    ...turboFilters
  ])

  if (primaryCode === 0) {
    return 0
  }

  return runFallbackTests(target)
}

try {
  const exitCode = await run()
  process.exit(exitCode)
} catch (error) {
  console.error(error)
  process.exit(1)
}
