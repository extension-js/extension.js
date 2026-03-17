#!/usr/bin/env node

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {spawn, spawnSync} from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

const supportedManagers = new Set(['pnpm', 'npm', 'yarn', 'bun'])
const pmIndex = process.argv.indexOf('--pm')
const cliPackageManager = pmIndex >= 0 ? process.argv[pmIndex + 1] : undefined
const scenarioIndex = process.argv.indexOf('--scenario')
const cliScenario =
  scenarioIndex >= 0 ? process.argv[scenarioIndex + 1] : 'default'
const packageManager = cliPackageManager || 'npm'

const supportedScenarios = new Set(['default', 'react-content-dev'])

function assertValidCliArgs(pm, scenario) {
  if (!pm || !supportedManagers.has(pm)) {
    throw new Error(
      'Usage: node ci-scripts/run-optional-deps-smoke.mjs --pm <pnpm|npm|yarn|bun>'
    )
  }

  if (!supportedScenarios.has(scenario)) {
    throw new Error(
      'Usage: node ci-scripts/run-optional-deps-smoke.mjs --pm <pnpm|npm|yarn|bun> [--scenario <default|react-content-dev>]'
    )
  }
}

const baseEnv = {
  ...process.env,
  CI: 'true',
  GITHUB_ACTIONS: process.env.GITHUB_ACTIONS || 'true',
  HUSKY: '0'
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryCleanupError(error) {
  const code = error && typeof error === 'object' ? error.code : undefined
  return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY'
}

async function removeDirectoryWithRetries(
  targetDir,
  {
    rm = (dir, options) => fs.rm(dir, options),
    maxAttempts = process.platform === 'win32' ? 20 : 5,
    baseDelayMs = 250
  } = {}
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rm(targetDir, {recursive: true, force: true})
      return
    } catch (error) {
      if (!shouldRetryCleanupError(error) || attempt === maxAttempts) {
        throw error
      }

      await wait(Math.min(baseDelayMs * attempt, 1500))
    }
  }
}

function childHasExited(child) {
  return !child || child.exitCode !== null || child.signalCode !== null
}

function waitForChildExit(child, timeoutMs = 10000) {
  if (childHasExited(child)) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const finalize = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off?.('close', finalize)
      child.off?.('exit', finalize)
      resolve()
    }

    const timeout = setTimeout(finalize, timeoutMs)
    child.once('close', finalize)
    child.once('exit', finalize)
  })
}

async function terminateChildProcess(child) {
  if (childHasExited(child)) return

  if (process.platform === 'win32' && child.pid) {
    await new Promise((resolve) => {
      try {
        const killer = spawn(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          {
            stdio: 'ignore',
            windowsHide: true
          }
        )

        killer.once('close', () => resolve())
        killer.once('error', () => resolve())
      } catch {
        resolve()
      }
    })

    await waitForChildExit(child, 10000)
    return
  }

  try {
    child.kill('SIGTERM')
  } catch {}

  await waitForChildExit(child, 1000)

  if (childHasExited(child)) return

  try {
    child.kill('SIGKILL')
  } catch {}

  await waitForChildExit(child, 5000)
}

function buildSmokeEnv(pm) {
  if (pm !== 'pnpm') return baseEnv

  const npmCommandPath = resolveCommandPath('npm')
  return {
    ...baseEnv,
    // Force the isolated optional-deps cache installs through npm so the
    // smoke test can focus on lockfile stability instead of host-specific
    // pnpm shim resolution in nested child processes.
    EXTENSION_JS_PACKAGE_MANAGER: 'npm',
    ...(npmCommandPath ? {EXTENSION_JS_PM_EXEC_PATH: npmCommandPath} : {})
  }
}

function commandFor(tool) {
  if (process.platform !== 'win32') return tool
  if (tool === 'pnpm') return 'pnpm.cmd'
  if (tool === 'npm') return 'npm.cmd'
  if (tool === 'yarn') return 'yarn.cmd'
  if (tool === 'bun') return 'bun.exe'
  return tool
}

function resolveCommandPath(tool) {
  const resolvedCommand = commandFor(tool)

  if (process.platform === 'win32') {
    return resolvedCommand
  }

  const result = spawnSync('which', [resolvedCommand], {
    env: baseEnv,
    encoding: 'utf8'
  })

  if (result.status === 0) {
    const value = String(result.stdout || '').trim()
    if (value) return value
  }

  return undefined
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

function runLong(command, args, cwd, env = baseEnv, opts = {}) {
  const resolvedCommand = commandFor(command)
  return spawn(resolvedCommand, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    ...opts
  })
}

function localCliPath() {
  return path.join(ROOT_DIR, 'programs', 'cli', 'dist', 'cli.cjs')
}

function shouldUseDirectLocalCli(pm) {
  return process.platform === 'win32' && pm === 'npm'
}

function runExtensionCli(args, cwd, env = baseEnv, pm = packageManager) {
  if (shouldUseDirectLocalCli(pm)) {
    return run(process.execPath, [localCliPath(), ...args], cwd, env)
  }

  return run('extension', args, cwd, env)
}

function runExtensionCliLong(args, cwd, env = baseEnv, pm = packageManager) {
  if (shouldUseDirectLocalCli(pm)) {
    return runLong(process.execPath, [localCliPath(), ...args], cwd, env)
  }

  return runLong('extension', args, cwd, env)
}

function fileSpecifier(toAbsPath, fromDir) {
  if (process.platform === 'win32') {
    const relative = path.relative(fromDir, toAbsPath).split(path.sep).join('/')
    const normalized = relative.startsWith('.') ? relative : `./${relative}`
    return `file:${normalized}`
  }
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

function sha1FileSync(filePath) {
  const content = fsSync.readFileSync(filePath)
  return crypto.createHash('sha1').update(content).digest('hex')
}

async function isWorkspaceBootstrapped() {
  return pathExists(path.join(ROOT_DIR, 'node_modules', '.pnpm', 'lock.yaml'))
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
    path.join(targetDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          jsx: 'react-jsx',
          moduleResolution: 'Bundler',
          strict: false,
          allowJs: true,
          skipLibCheck: true
        },
        include: ['src']
      },
      null,
      2
    )}\n`
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
    [
      '@import "tailwindcss";',
      '',
      'body {',
      '  font-family: sans-serif;',
      '}',
      ''
    ].join('\n')
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

async function writeReactContentDevFixture(targetDir) {
  await fs.mkdir(path.join(targetDir, 'src', 'content'), {recursive: true})

  const packageJson = {
    private: true,
    name: 'extjs-react-content-dev-smoke',
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'extension dev',
      build: 'extension build'
    },
    dependencies: {
      react: '^18.3.1',
      'react-dom': '^18.3.1'
    },
    devDependencies: {
      extension: '0.0.0-smoke'
    }
  }

  await fs.writeFile(
    path.join(targetDir, 'package.json'),
    `${JSON.stringify(packageJson, null, 2)}\n`
  )

  await fs.writeFile(
    path.join(targetDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          jsx: 'react-jsx',
          moduleResolution: 'Bundler',
          strict: false,
          allowJs: true,
          skipLibCheck: true
        },
        include: ['src']
      },
      null,
      2
    )}\n`
  )

  await fs.writeFile(
    path.join(targetDir, 'manifest.json'),
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: 'Extension.js React Content Dev Smoke',
        version: '1.0.0',
        content_scripts: [
          {
            matches: ['https://example.com/*'],
            js: ['src/content/scripts.tsx'],
            run_at: 'document_idle'
          }
        ]
      },
      null,
      2
    )}\n`
  )

  await fs.writeFile(
    path.join(targetDir, 'src', 'content', 'ContentApp.tsx'),
    [
      'export function ContentApp() {',
      '  return <div data-testid="react-content-smoke">Smoke fixture</div>',
      '}',
      ''
    ].join('\n')
  )

  await fs.writeFile(
    path.join(targetDir, 'src', 'content', 'scripts.tsx'),
    [
      "import ReactDOM from 'react-dom/client'",
      "import {ContentApp} from './ContentApp'",
      '',
      'export default function main() {',
      "  const host = document.createElement('div')",
      "  host.id = 'extjs-react-content-smoke-root'",
      '  document.documentElement.append(host)',
      '  const shadowRoot = host.attachShadow({mode: "open"})',
      "  const style = document.createElement('style')",
      '  style.textContent = ":host { all: initial; }"',
      '  shadowRoot.append(style)',
      "  const appRoot = document.createElement('div')",
      "  appRoot.className = 'content_script'",
      '  shadowRoot.append(appRoot)',
      '  const mountingPoint = ReactDOM.createRoot(appRoot)',
      '  mountingPoint.render(',
      '    <div className="content_script">',
      '      <ContentApp />',
      '    </div>',
      '  )',
      '',
      '  return () => {',
      '    mountingPoint.unmount()',
      '    host.remove()',
      '  }',
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

  const defaultBrowserExtension = path.join(
    ROOT_DIR,
    'extensions',
    'browser-extension'
  )
  if (await pathExists(defaultBrowserExtension)) {
    return {
      sourceDir: defaultBrowserExtension,
      sourceName: 'extensions/browser-extension'
    }
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
  const useRegistryExtension =
    pm === 'bun' ||
    pm === 'yarn' ||
    (pm === 'pnpm' && process.platform === 'win32')

  if (useRegistryExtension) {
    // Bun and Yarn classic do not resolve workspace:* dependency ranges inside
    // a file-linked CLI package in this isolated fixture setup. Windows pnpm
    // also fails for the same reason under temp fixture paths. Use a registry
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
    packageJson.devDependencies.extension = fileSpecifier(cliPath, workdir)
  }

  if (!useRegistryExtension) {
    packageJson.pnpm ||= {}
    packageJson.pnpm.overrides ||= {}
    packageJson.pnpm.overrides.extension = fileSpecifier(cliPath, workdir)
    packageJson.pnpm.overrides['extension-create'] = fileSpecifier(
      createPath,
      workdir
    )
    packageJson.pnpm.overrides['extension-develop'] = fileSpecifier(
      developPath,
      workdir
    )
    packageJson.pnpm.overrides['extension-install'] = fileSpecifier(
      installPath,
      workdir
    )
  }

  await fs.writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`
  )
}

function installAndBuild(workdir, pm) {
  const smokeEnv = {
    ...buildSmokeEnv(pm),
    EXTENSION_JS_CACHE_DIR: path.join(workdir, '.extensionjs-cache')
  }

  if (pm === 'pnpm') {
    const lockfilePath = path.join(workdir, 'pnpm-lock.yaml')
    run(
      'pnpm',
      [
        'install',
        '--lockfile-only',
        '--ignore-workspace',
        '--no-frozen-lockfile'
      ],
      workdir,
      smokeEnv
    )
    run('pnpm', ['install', '--frozen-lockfile'], workdir, smokeEnv)
    const firstLockHash = sha1FileSync(lockfilePath)
    run('pnpm', ['build:production'], workdir, smokeEnv)
    const firstBuildLockHash = sha1FileSync(lockfilePath)

    if (firstLockHash !== firstBuildLockHash) {
      throw new Error('pnpm build mutated pnpm-lock.yaml after initial install')
    }

    run('pnpm', ['install', '--frozen-lockfile'], workdir, smokeEnv)

    const secondLockHash = sha1FileSync(lockfilePath)
    run('pnpm', ['build:production'], workdir, smokeEnv)

    const secondBuildLockHash = sha1FileSync(lockfilePath)

    if (secondLockHash !== secondBuildLockHash) {
      throw new Error(
        'pnpm build mutated pnpm-lock.yaml after frozen reinstall'
      )
    }
    return
  }

  if (pm === 'npm') {
    run('npm', ['install', '--no-audit', '--no-fund'], workdir, smokeEnv)
    if (shouldUseDirectLocalCli(pm)) {
      runExtensionCli(['build'], workdir, smokeEnv, pm)
    } else {
      run('npm', ['run', 'build:production'], workdir, smokeEnv)
    }
    return
  }

  if (pm === 'yarn') {
    try {
      run('yarn', ['install', '--immutable'], workdir, smokeEnv)
    } catch {
      run('yarn', ['install'], workdir, smokeEnv)
    }
    run('yarn', ['build:production'], workdir, smokeEnv)
    return
  }

  if (pm === 'bun') {
    try {
      run('bun', ['install', '--frozen-lockfile'], workdir, smokeEnv)
    } catch {
      run('bun', ['install'], workdir, smokeEnv)
    }
    run('bun', ['run', 'build:production'], workdir, smokeEnv)
  }
}

function runReactContentDevSmoke(workdir) {
  const smokeEnv = {
    ...buildSmokeEnv('npm'),
    EXTENSION_JS_CACHE_DIR: path.join(workdir, '.extensionjs-cache')
  }
  const successPattern = /compiled successfully|compiled with warnings/i
  const failurePatterns = [
    /compiled with errors/i,
    /Module parse failed/i,
    /Optional dependency install reported success but packages are missing/i,
    /Unhandled rejection/i,
    /could not be resolved after optional dependency installation/i
  ]
  const timeoutMs = 180000

  return new Promise((resolve, reject) => {
    const child = shouldUseDirectLocalCli('npm')
      ? runExtensionCliLong(['dev', '--browser=chrome', '--no-browser'], workdir, smokeEnv, 'npm')
      : runLong(
          'npm',
          ['run', 'dev', '--', '--browser=chrome', '--no-browser'],
          workdir,
          smokeEnv
        )

    let output = ''
    let settled = false

    const finish = async (error) => {
      if (settled) return
      settled = true

      clearTimeout(timeout)
      await terminateChildProcess(child)

      if (error) {
        reject(error)
      } else {
        resolve(output)
      }
    }

    const timeout = setTimeout(() => {
      finish(
        new Error(
          `Timed out waiting for react content dev smoke to compile.\n\nOutput tail:\n${output.slice(-8000)}`
        )
      )
    }, timeoutMs)

    const onChunk = (chunk) => {
      const text = chunk.toString()
      output += text

      for (const pattern of failurePatterns) {
        if (pattern.test(text) || pattern.test(output)) {
          void finish(
            new Error(
              `React content dev smoke hit failure pattern: ${String(
                pattern
              )}\n\nCaptured output:\n${output}`
            )
          )
          return
        }
      }

      if (successPattern.test(output)) {
        setTimeout(() => {
          void finish()
        }, 5000)
      }
    }

    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', (error) => {
      void finish(error)
    })
    child.on('close', (code) => {
      if (settled) return
      void finish(
        new Error(
          `React content dev smoke exited early with code ${code}\n\n${output}`
        )
      )
    })
  })
}

async function installWorkspaceDependencies() {
  if (await isWorkspaceBootstrapped()) {
    console.log(
      '\nWorkspace dependencies already present; skipping broad workspace install.'
    )
    return
  }

  try {
    run('pnpm', ['--dir', ROOT_DIR, 'install', '--frozen-lockfile'], ROOT_DIR)
  } catch (error) {
    console.warn(
      '\nFrozen workspace install failed; retrying with --no-frozen-lockfile for smoke execution.'
    )
    run(
      'pnpm',
      ['--dir', ROOT_DIR, 'install', '--no-frozen-lockfile'],
      ROOT_DIR
    )
    if (error instanceof Error) {
      console.warn(`Original frozen-lockfile failure: ${error.message}`)
    }
  }
}

async function main() {
  assertValidCliArgs(cliPackageManager, cliScenario)

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
    await installWorkspaceDependencies()

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

    if (
      cliScenario === 'react-content-dev' ||
      (process.platform === 'win32' && packageManager === 'npm')
    ) {
      const reactDevDir = path.join(tempRoot, 'react-content-dev')
      await writeReactContentDevFixture(reactDevDir)
      await rewriteConsumerPackageJson(reactDevDir, 'npm')
      run('npm', ['install', '--no-audit', '--no-fund'], reactDevDir, {
        ...buildSmokeEnv('npm'),
        EXTENSION_JS_CACHE_DIR: path.join(reactDevDir, '.extensionjs-cache')
      })
      await runReactContentDevSmoke(reactDevDir)
      console.log(
        '\nWindows/npm React content-script dev smoke completed successfully.'
      )
    }

    console.log(
      '\nOptional dependency matrix smoke test completed successfully.'
    )
  } finally {
    if (process.env.EXTJS_KEEP_SMOKE_TMP !== '1') {
      await removeDirectoryWithRetries(tempRoot)
    } else {
      console.log(`Keeping temporary workspace: ${tempRoot}`)
    }
  }
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).toString()

if (isDirectExecution) {
  main().catch((error) => {
    console.error('\nOptional dependency matrix smoke test failed.')
    console.error(error instanceof Error ? error.stack : error)
    process.exit(1)
  })
}

export {
  removeDirectoryWithRetries,
  shouldRetryCleanupError,
  terminateChildProcess,
  waitForChildExit
}
