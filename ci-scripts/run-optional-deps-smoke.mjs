#!/usr/bin/env node

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

const supportedManagers = new Set(['pnpm', 'npm', 'yarn', 'bun'])
const pmIndex = process.argv.indexOf('--pm')
const packageManager = pmIndex >= 0 ? process.argv[pmIndex + 1] : undefined

if (!packageManager || !supportedManagers.has(packageManager)) {
  console.error(
    'Usage: node ci-scripts/run-optional-deps-smoke.mjs --pm <pnpm|npm|yarn|bun>'
  )
  process.exit(1)
}

const baseEnv = {
  ...process.env,
  CI: 'true',
  GITHUB_ACTIONS: process.env.GITHUB_ACTIONS || 'true',
  HUSKY: '0'
}

function run(command, args, cwd, env = baseEnv) {
  const rendered = [command, ...args].join(' ')
  console.log(`\n$ (${cwd}) ${rendered}`)
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit'
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(
      `Command failed with exit code ${result.status}: ${rendered}`
    )
  }
}

function fileSpecifier(toAbsPath) {
  return pathToFileURL(toAbsPath).toString()
}

async function rewriteConsumerPackageJson(workdir) {
  const packageJsonPath = path.join(workdir, 'package.json')
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))

  const cliPath = path.join(ROOT_DIR, 'programs', 'cli')
  const createPath = path.join(ROOT_DIR, 'programs', 'create')
  const developPath = path.join(ROOT_DIR, 'programs', 'develop')
  const installPath = path.join(ROOT_DIR, 'programs', 'install')

  packageJson.devDependencies ||= {}
  packageJson.devDependencies.extension = fileSpecifier(cliPath)

  packageJson.pnpm ||= {}
  packageJson.pnpm.overrides ||= {}
  packageJson.pnpm.overrides.extension = fileSpecifier(cliPath)
  packageJson.pnpm.overrides['extension-create'] = fileSpecifier(createPath)
  packageJson.pnpm.overrides['extension-develop'] = fileSpecifier(developPath)
  packageJson.pnpm.overrides['extension-install'] = fileSpecifier(installPath)

  await fs.writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`
  )
}

function installAndBuild(workdir, pm) {
  if (pm === 'pnpm') {
    run(
      'pnpm',
      [
        'install',
        '--lockfile-only',
        '--ignore-workspace',
        '--no-frozen-lockfile'
      ],
      workdir
    )
    run('pnpm', ['install', '--frozen-lockfile'], workdir)
    run('pnpm', ['build:production'], workdir)
    return
  }

  if (pm === 'npm') {
    run('npm', ['install', '--no-audit', '--no-fund'], workdir)
    run('npm', ['run', 'build:production'], workdir)
    return
  }

  if (pm === 'yarn') {
    try {
      run('yarn', ['install', '--immutable'], workdir)
    } catch {
      run('yarn', ['install'], workdir)
    }
    run('yarn', ['build:production'], workdir)
    return
  }

  if (pm === 'bun') {
    try {
      run('bun', ['install', '--frozen-lockfile'], workdir)
    } catch {
      run('bun', ['install'], workdir)
    }
    run('bun', ['run', 'build:production'], workdir)
  }
}

async function main() {
  const browserExtensionPath = path.join(
    ROOT_DIR,
    'extensions',
    'browser-extension'
  )
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'extjs-optional-deps-')
  )
  const workdir = path.join(tempRoot, 'browser-extension')

  try {
    console.log(`Using temporary workspace: ${workdir}`)

    // CI jobs may check out source without node_modules. Install workspace deps
    // before compiling local packages that rely on build tools like rslib.
    run('pnpm', ['--dir', ROOT_DIR, 'install', '--frozen-lockfile'], ROOT_DIR)

    run(
      'pnpm',
      ['--dir', ROOT_DIR, '--filter', 'extension-develop', 'compile'],
      ROOT_DIR
    )
    run(
      'pnpm',
      ['--dir', ROOT_DIR, '--filter', 'extension-create', 'compile'],
      ROOT_DIR
    )
    run(
      'pnpm',
      ['--dir', ROOT_DIR, '--filter', 'extension-install', 'compile'],
      ROOT_DIR
    )
    run(
      'pnpm',
      ['--dir', ROOT_DIR, '--filter', 'extension', 'compile'],
      ROOT_DIR
    )

    await fs.cp(browserExtensionPath, workdir, {recursive: true})
    await rewriteConsumerPackageJson(workdir)
    installAndBuild(workdir, packageManager)

    console.log(
      '\nOptional dependency matrix smoke test completed successfully.'
    )
  } finally {
    if (process.env.EXTJS_KEEP_SMOKE_TMP !== '1') {
      await fs.rm(tempRoot, {recursive: true, force: true})
    } else {
      console.log(`Keeping temporary workspace: ${tempRoot}`)
    }
  }
}

main().catch((error) => {
  console.error('\nOptional dependency matrix smoke test failed.')
  console.error(error instanceof Error ? error.stack : error)
  process.exit(1)
})
