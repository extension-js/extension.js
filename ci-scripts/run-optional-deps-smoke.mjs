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

function commandFor(tool) {
  if (process.platform !== 'win32') return tool
  if (tool === 'pnpm') return 'pnpm.cmd'
  if (tool === 'npm') return 'npm.cmd'
  if (tool === 'yarn') return 'yarn.cmd'
  if (tool === 'bun') return 'bun.exe'
  return tool
}

function run(command, args, cwd, env = baseEnv) {
  const resolvedCommand = commandFor(command)
  const rendered = [resolvedCommand, ...args].join(' ')
  console.log(`\n$ (${cwd}) ${rendered}`)
  const result = spawnSync(resolvedCommand, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
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

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function writeFallbackFixture(targetDir) {
  await fs.mkdir(path.join(targetDir, 'src'), {recursive: true})

  const packageJson = {
    private: true,
    name: 'extjs-optional-deps-smoke',
    version: '0.0.0',
    type: 'module',
    scripts: {
      build: 'extension build',
      'build:production': 'extension build'
    },
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1'
    },
    devDependencies: {
      extension: '0.0.0-smoke',
      postcss: '^8.5.6',
      tailwindcss: '^4.1.17',
      '@tailwindcss/postcss': '^4.1.17'
    }
  }

  await fs.writeFile(
    path.join(targetDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  )

  await fs.writeFile(
    path.join(targetDir, 'manifest.json'),
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: 'Extension.js Optional Deps Smoke',
        version: '1.0.0',
        action: {default_popup: 'popup.html'},
        background: {service_worker: 'src/background.js'}
      },
      null,
      2
    )}\n`
  )

  await fs.writeFile(
    path.join(targetDir, 'popup.html'),
    [
      '<!doctype html>',
      '<html>',
      '  <body>',
      '    <div id="root"></div>',
      '    <script type="module" src="./src/popup.jsx"></script>',
      '  </body>',
      '</html>',
      ''
    ].join('\n')
  )

  await fs.writeFile(
    path.join(targetDir, 'postcss.config.cjs'),
    [
      'module.exports = {',
      "  plugins: [require('@tailwindcss/postcss')],",
      '}',
      ''
    ].join('\n')
  )

  await fs.writeFile(
    path.join(targetDir, 'src', 'background.js'),
    "console.log('optional-deps smoke background ready')\n"
  )

  await fs.writeFile(
    path.join(targetDir, 'src', 'popup.css'),
    ['@import "tailwindcss";', '', 'body {', '  font-family: sans-serif;', '}', ''].join(
      '\n'
    )
  )

  await fs.writeFile(
    path.join(targetDir, 'src', 'popup.jsx'),
    [
      "import React from 'react'",
      "import {createRoot} from 'react-dom/client'",
      "import './popup.css'",
      '',
      "const root = document.getElementById('root')",
      '',
      'if (root) {',
      "  createRoot(root).render(React.createElement('div', null, 'Smoke fixture'))",
      '}',
      ''
    ].join('\n')
  )
}

async function resolveConsumerSourceDir(tempRoot) {
  if (process.env.EXTJS_SMOKE_USE_FALLBACK === '1') {
    const forcedFallback = path.join(tempRoot, 'fallback-consumer-fixture')
    await writeFallbackFixture(forcedFallback)
    return {sourceDir: forcedFallback, sourceName: 'forced fallback fixture'}
  }

  const fromEnv = process.env.BROWSER_EXTENSION_DIR
  if (fromEnv && (await pathExists(fromEnv))) {
    return {sourceDir: fromEnv, sourceName: 'BROWSER_EXTENSION_DIR override'}
  }

  const defaultBrowserExtension = path.join(ROOT_DIR, 'extensions', 'browser-extension')
  if (await pathExists(defaultBrowserExtension)) {
    return {sourceDir: defaultBrowserExtension, sourceName: 'extensions/browser-extension'}
  }

  const fallbackFixture = path.join(tempRoot, 'fallback-consumer-fixture')
  await writeFallbackFixture(fallbackFixture)
  return {sourceDir: fallbackFixture, sourceName: 'generated fallback fixture'}
}

async function rewriteConsumerPackageJson(workdir, pm) {
  const packageJsonPath = path.join(workdir, 'package.json')
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))

  const cliPath = path.join(ROOT_DIR, 'programs', 'cli')
  const createPath = path.join(ROOT_DIR, 'programs', 'create')
  const developPath = path.join(ROOT_DIR, 'programs', 'develop')
  const installPath = path.join(ROOT_DIR, 'programs', 'install')

  packageJson.devDependencies ||= {}
  if (pm === 'bun' || pm === 'yarn') {
    // Bun and Yarn classic do not resolve workspace:* dependency ranges inside
    // a file-linked CLI package in this isolated fixture setup. Use a registry
    // tag so these lanes still verify install/build behavior.
    packageJson.devDependencies.extension =
      process.env.EXTJS_SMOKE_REGISTRY_EXTENSION_VERSION || 'canary'
    if (packageJson.pnpm?.overrides) {
      delete packageJson.pnpm.overrides.extension
      delete packageJson.pnpm.overrides['extension-create']
      delete packageJson.pnpm.overrides['extension-develop']
      delete packageJson.pnpm.overrides['extension-install']
    }
  } else {
    packageJson.devDependencies.extension = fileSpecifier(cliPath)
  }

  if (pm !== 'bun' && pm !== 'yarn') {
    packageJson.pnpm ||= {}
    packageJson.pnpm.overrides ||= {}
    packageJson.pnpm.overrides.extension = fileSpecifier(cliPath)
    packageJson.pnpm.overrides['extension-create'] = fileSpecifier(createPath)
    packageJson.pnpm.overrides['extension-develop'] = fileSpecifier(developPath)
    packageJson.pnpm.overrides['extension-install'] = fileSpecifier(installPath)
  }

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

function installWorkspaceDependencies() {
  try {
    run('pnpm', ['--dir', ROOT_DIR, 'install', '--frozen-lockfile'], ROOT_DIR)
  } catch (error) {
    console.warn(
      '\nFrozen workspace install failed; retrying with --no-frozen-lockfile for smoke execution.'
    )
    run('pnpm', ['--dir', ROOT_DIR, 'install', '--no-frozen-lockfile'], ROOT_DIR)
    if (error instanceof Error) {
      console.warn(`Original frozen-lockfile failure: ${error.message}`)
    }
  }
}

async function main() {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'extjs-optional-deps-')
  )
  const workdir = path.join(tempRoot, 'browser-extension')

  try {
    console.log(`Using temporary workspace: ${workdir}`)
    const {sourceDir, sourceName} = await resolveConsumerSourceDir(tempRoot)
    console.log(`Using consumer source: ${sourceDir} (${sourceName})`)

    // CI jobs may check out source without node_modules. Install workspace deps
    // before compiling local packages that rely on build tools like rslib.
    installWorkspaceDependencies()

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

    await fs.cp(sourceDir, workdir, {recursive: true})
    await rewriteConsumerPackageJson(workdir, packageManager)
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
