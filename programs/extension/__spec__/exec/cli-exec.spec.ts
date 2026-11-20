import {spawn, spawnSync} from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  type ExamplesCatalogFixture,
  fixtureExtensionFiles,
  serveExamplesCatalog
} from '../../../create/__spec__/examples-catalog-fixture'
import {DEFAULT_TEMPLATE} from '../../helpers/template-catalog'
import {killCliTree} from '../helpers/run-cli'

type Runner = {
  name: string
  command: string
  buildArgs: (packages: string[], cmdArgs: string[]) => string[]
  isAvailable: () => boolean
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../../../..')
const cliDir = resolve(repoRoot, 'programs/extension')
const createDir = resolve(repoRoot, 'programs/create')
const developDir = resolve(repoRoot, 'programs/develop')

const nodeDir = dirname(process.execPath)
const pathDelim = process.platform === 'win32' ? ';' : ':'
const pnpmFromBin = join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
)
const pnpmFromNodeDir = join(
  nodeDir,
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
)
const pnpmHome = process.env.PNPM_HOME
const pnpmFromPnpmHome = pnpmHome
  ? join(pnpmHome, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  : ''
const pnpmCommand = existsSync(pnpmFromBin)
  ? pnpmFromBin
  : existsSync(pnpmFromNodeDir)
    ? pnpmFromNodeDir
    : pnpmFromPnpmHome && existsSync(pnpmFromPnpmHome)
      ? pnpmFromPnpmHome
      : 'pnpm'

const npmFromBin = join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'npm.cmd' : 'npm'
)
const npmFromNodeDir = join(
  nodeDir,
  process.platform === 'win32' ? 'npm.cmd' : 'npm'
)
const npmCommand = existsSync(npmFromBin)
  ? npmFromBin
  : existsSync(npmFromNodeDir)
    ? npmFromNodeDir
    : 'npm'

const existingPath = process.env.PATH || process.env.Path || ''
const pathParts = [nodeDir]
if (pnpmHome) pathParts.push(pnpmHome)

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  PATH: pathParts.join(pathDelim) + pathDelim + existingPath
}

const defaultEnv: NodeJS.ProcessEnv = {
  ...baseEnv,
  EXTENSION_DEV_NO_BROWSER: '1',
  EXTENSION_ENV: 'test',
  EXTENSION_SKIP_INTERNAL_INSTALL: 'true',
  EXTENSION_ALLOW_HTTP_TEMPLATE: 'true'
}

let catalog: ExamplesCatalogFixture | undefined

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function removeWorkspaceWithRetry(targetPath: string, attempts = 6) {
  let lastError: unknown

  for (let index = 0; index < attempts; index++) {
    try {
      rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100
      })

      return
    } catch (error) {
      lastError = error
      const err = error as NodeJS.ErrnoException
      const retryable =
        err?.code === 'EBUSY' ||
        err?.code === 'ENOTEMPTY' ||
        err?.code === 'EPERM'

      if (!retryable || index === attempts - 1) {
        throw error
      }

      sleepSync(150)
    }
  }

  if (lastError) throw lastError
}

function cleanupWorkspaceAfterTimedDev(targetPath: string, timedOut: boolean) {
  try {
    removeWorkspaceWithRetry(targetPath, timedOut ? 12 : 6)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    const isBusy =
      err?.code === 'EBUSY' ||
      err?.code === 'ENOTEMPTY' ||
      err?.code === 'EPERM'

    if (timedOut && isBusy) {
      return
    }

    throw error
  }
}

// A runner probe that cannot install the packed tarballs within this budget
// is skipped, with a line in the log saying so. npm waits five minutes per
// stuck fetch, so a degraded registry would otherwise outlive the hook.
const PROBE_TIMEOUT_MS = 90_000

function runCommand(
  command: string,
  args: string[],
  options: {cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number} = {}
) {
  const {timeoutMs, ...spawnOptions} = options
  const useShell =
    process.platform === 'win32' &&
    (command.endsWith('.cmd') || command.endsWith('.bat'))
  const result = spawnSync(command, args, {
    ...spawnOptions,
    stdio: 'pipe',
    encoding: 'utf8',
    ...(timeoutMs ? {timeout: timeoutMs, killSignal: 'SIGKILL' as const} : {}),
    ...(useShell ? {shell: true} : {})
  })

  const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code

  if (result.error && errorCode !== 'ETIMEDOUT') {
    throw result.error
  }

  return result
}

async function runUntilTimeout(
  command: string,
  args: string[],
  options: {cwd?: string; env?: NodeJS.ProcessEnv} = {},
  timeoutMs = 5000
) {
  return await new Promise<{
    status: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
    timedOut: boolean
  }>((resolvePromise) => {
    const useShell =
      process.platform === 'win32' &&
      (command.endsWith('.cmd') || command.endsWith('.bat'))
    const child = spawn(command, args, {
      ...options,
      stdio: 'pipe',
      detached: true,
      ...(useShell ? {shell: true} : {})
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let resolved = false

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    const finalize = (status: number | null, signal: NodeJS.Signals | null) => {
      if (resolved) return

      resolved = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      clearTimeout(forceFinalizeTimer)
      resolvePromise({status, signal, stdout, stderr, timedOut})
    }

    // Windows has no polite signal for a console tree, so the first ask
    // there is already the tree kill.
    const timer = setTimeout(() => {
      timedOut = true

      if (process.platform === 'win32' || !child.pid) {
        killCliTree(child)

        return
      }

      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // Already gone
      }
    }, timeoutMs)

    const killTimer = setTimeout(() => {
      if (!resolved) killCliTree(child)
    }, timeoutMs + 3000)

    const forceFinalizeTimer = setTimeout(() => {
      if (resolved) return

      finalize(null, 'SIGKILL')
    }, timeoutMs + 10000)

    child.on('close', (status, signal) => {
      finalize(status, signal)
    })

    child.on('error', () => {
      finalize(null, null)
    })
  })
}

function ensureCompiled(pkgDir: string, distEntry: string) {
  if (existsSync(distEntry)) return

  const result = runCommand(pnpmCommand, ['-C', pkgDir, 'run', 'compile'], {
    cwd: pkgDir,
    env: baseEnv
  })

  if ((result.status || 0) !== 0) {
    throw new Error(
      `Failed to compile ${pkgDir}\n${result.stdout}\n${result.stderr}`
    )
  }
}

function packPackage(pkgDir: string, packDir: string) {
  const before = new Set(readdirSync(packDir))
  const result = runCommand(
    pnpmCommand,
    ['pack', '--pack-destination', packDir],
    {
      cwd: pkgDir,
      env: baseEnv
    }
  )

  if ((result.status || 0) !== 0) {
    throw new Error(
      `Failed to pack ${pkgDir}\n${result.stdout}\n${result.stderr}`
    )
  }

  const after = readdirSync(packDir)
    .filter((name) => name.endsWith('.tgz') && !before.has(name))
    .map((name) => resolve(packDir, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)

  if (after.length === 0) {
    throw new Error(`No tarball produced for ${pkgDir}`)
  }

  return after[0]
}

function isRunnerAvailable(command: string, args: string[] = ['--version']) {
  try {
    const result = runCommand(command, args)

    return (result.status || 0) === 0
  } catch {
    return false
  }
}

function supportsPackageFlag(command: string, args: string[]) {
  try {
    const result = runCommand(command, args)
    if ((result.status || 0) !== 0) return false

    const text = `${result.stdout || ''}${result.stderr || ''}`

    return text.includes('--package') || text.includes('-p, --package')
  } catch {
    return false
  }
}

function resolveCliBin() {
  const cjs = resolve(cliDir, 'dist', 'cli.cjs')
  if (existsSync(cjs)) return cjs

  return resolve(cliDir, 'dist', 'cli.js')
}

let packDir = ''
let cliTgz = ''
let createTgz = ''
let developTgz = ''
const runnerReady = new Map<string, boolean>()

// Every runner takes the tarball paths bare. pnpm 10 dlx reads a
// `name@file:/abs` spec under its own cache folder and fails with ENOENT.
function getPackagesForRunner() {
  return [cliTgz, createTgz, developTgz]
}

// No bunx lane: bunx keeps one --package and takes that package's own
// dependencies from the registry, so it would run a published engine.
const runners: Runner[] = [
  {
    name: 'npx',
    command: 'npx',
    buildArgs: (packages, cmdArgs) => [
      '-y',
      ...packages.flatMap((pkg) => ['--package', pkg]),
      'extension',
      ...cmdArgs
    ],
    isAvailable: () => isRunnerAvailable('npx')
  },
  {
    name: 'npmExec',
    command: 'npm',
    buildArgs: (packages, cmdArgs) => [
      'exec',
      '--yes',
      ...packages.flatMap((pkg) => ['--package', pkg]),
      '--',
      'extension',
      ...cmdArgs
    ],
    isAvailable: () => isRunnerAvailable('npm')
  },
  {
    name: 'pnpmDlx',
    command: pnpmCommand,
    buildArgs: (packages, cmdArgs) => [
      'dlx',
      ...packages.flatMap((pkg) => ['--package', pkg]),
      'extension',
      ...cmdArgs
    ],
    isAvailable: () =>
      isRunnerAvailable(pnpmCommand) &&
      supportsPackageFlag(pnpmCommand, ['dlx', '--help'])
  }
]

const availableRunners = runners.filter((runner) => runner.isAvailable())

beforeAll(
  async () => {
    catalog = await serveExamplesCatalog({
      [DEFAULT_TEMPLATE]: fixtureExtensionFiles(DEFAULT_TEMPLATE)
    })

    defaultEnv.EXTENSION_CREATE_TEMPLATE_URL = catalog.url
    packDir = mkdtempSync(join(tmpdir(), 'extjs-cli-pack-'))
    ensureCompiled(cliDir, resolve(cliDir, 'dist/cli.cjs'))
    ensureCompiled(createDir, resolve(createDir, 'dist/module.cjs'))
    ensureCompiled(developDir, resolve(developDir, 'dist/module.cjs'))
    cliTgz = packPackage(cliDir, packDir)
    createTgz = packPackage(createDir, packDir)
    developTgz = packPackage(developDir, packDir)

    for (const runner of runners) {
      if (!runner.isAvailable()) {
        runnerReady.set(runner.name, false)
        continue
      }

      // Probe in a throwaway dir, NOT repoRoot: at repoRoot the runner finds the
      // workspace-installed `extension` and passes without ever installing the
      // tarballs, so a runner that cannot install local file: tarballs (e.g. pnpm
      // dlx on Windows) reads as ready and its real tests then fail mid-flight.
      const smokeDir = mkdtempSync(join(tmpdir(), 'extjs-cli-smoke-'))

      try {
        const smoke = runCommand(
          runner.command,
          runner.buildArgs(getPackagesForRunner(), ['--help']),
          {cwd: smokeDir, env: defaultEnv, timeoutMs: PROBE_TIMEOUT_MS}
        )
        const ready = !smoke.error && (smoke.status || 0) === 0
        runnerReady.set(runner.name, ready)

        if (!ready) {
          const why = smoke.error
            ? `did not finish within ${PROBE_TIMEOUT_MS} ms`
            : `exited ${smoke.status ?? smoke.signal}`
          // The runner's own last lines, or a skip on CI never names its cause.
          const said = String(smoke.stderr || smoke.stdout || '')
            .trim()
            .split(/\r?\n/)
            .slice(-6)
            .join('\n')
          console.warn(
            `[cli-exec] ${runner.name} probe ${why}; its cases are skipped\n${said}`
          )
        }
      } finally {
        rmSync(smokeDir, {recursive: true, force: true})
      }
    }
    // Packing three tarballs plus one bounded probe per runner.
  },
  120_000 + runners.length * PROBE_TIMEOUT_MS
)

afterAll(async () => {
  if (packDir) {
    rmSync(packDir, {recursive: true, force: true})
  }

  await catalog?.close()
})

describe.each(availableRunners)('cli exec flow (%s)', (runner) => {
  // Tarballs are packed in the top-level beforeAll, which runs AFTER collection;
  // resolve the --package specs here so they hold real paths, not empty strings.
  let packages: string[] = []
  beforeAll(() => {
    packages = getPackagesForRunner()
  })

  const isNpmFamilyExec = runner.name === 'npx' || runner.name === 'npmExec'
  const shouldAssertNoNodeModules = !isNpmFamilyExec

  // A runner whose probe failed reports its cases as skipped, never as passed.
  const skipUnlessReady = (skip: (note?: string) => void) => {
    if (!runnerReady.get(runner.name)) {
      skip(`${runner.name} could not run the packed CLI`)
    }
  }

  it('creates default template without install', ({skip}) => {
    skipUnlessReady(skip)

    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-create-'))
    const projectPath = join(workspace, 'app-default')

    try {
      const result = runCommand(
        runner.command,
        runner.buildArgs(packages, [
          'create',
          projectPath,
          '--install',
          'false'
        ]),
        {cwd: workspace, env: defaultEnv}
      )
      expect(result.status).toBe(0)
      expect(existsSync(join(projectPath, 'package.json'))).toBe(true)
      const pkg = JSON.parse(
        readFileSync(join(projectPath, 'package.json'), 'utf8')
      )
      expect(pkg.devDependencies?.extension).toBeTruthy()

      const provenance = JSON.parse(
        readFileSync(join(projectPath, '.extension-create.json'), 'utf8')
      )
      expect(provenance.template).toBe(DEFAULT_TEMPLATE)
      expect(provenance.source).toBe(catalog?.url)

      if (shouldAssertNoNodeModules) {
        expect(existsSync(join(projectPath, 'node_modules'))).toBe(false)
      }
    } finally {
      removeWorkspaceWithRetry(workspace)
    }
  })

  it.skipIf(isNpmFamilyExec)(
    'creates explicit template without install',
    ({skip}) => {
      skipUnlessReady(skip)

      const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-create-'))
      const projectPath = join(workspace, 'app-template')

      try {
        const result = runCommand(
          runner.command,
          runner.buildArgs(packages, [
            'create',
            projectPath,
            '--template',
            'javascript',
            '--install',
            'false'
          ]),
          {cwd: workspace, env: defaultEnv}
        )
        expect(result.status).toBe(0)
        expect(existsSync(join(projectPath, 'package.json'))).toBe(true)
      } finally {
        removeWorkspaceWithRetry(workspace)
      }
    }
  )

  // The unpacked extension is written here, so the case runs on every machine.
  it('previews a prebuilt extension without install', ({skip}) => {
    skipUnlessReady(skip)

    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-preview-'))
    const extensionPath = join(workspace, 'prebuilt')
    mkdirSync(extensionPath, {recursive: true})
    writeFileSync(
      join(extensionPath, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'Prebuilt Preview',
        version: '1.0.0'
      })
    )

    try {
      const result = runCommand(
        runner.command,
        runner.buildArgs(packages, ['preview', extensionPath, '--no-browser']),
        {cwd: workspace, env: defaultEnv}
      )
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain('Prebuilt Preview')
    } finally {
      removeWorkspaceWithRetry(workspace)
    }
  })

  it.skipIf(isNpmFamilyExec)(
    'builds without install when project has no deps',
    ({skip}) => {
      skipUnlessReady(skip)

      const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-noinstall-'))
      const projectPath = join(workspace, 'app-build')

      try {
        const createResult = runCommand(
          runner.command,
          runner.buildArgs(packages, [
            'create',
            projectPath,
            '--template',
            'javascript',
            '--install',
            'false'
          ]),
          {cwd: workspace, env: defaultEnv}
        )
        expect(createResult.status).toBe(0)

        const buildResult = runCommand(
          runner.command,
          runner.buildArgs(packages, [
            'build',
            projectPath,
            '--silent',
            'true',
            '--install',
            'false'
          ]),
          {cwd: projectPath, env: defaultEnv}
        )
        expect(buildResult.status).toBe(0)

        if (shouldAssertNoNodeModules) {
          expect(existsSync(join(projectPath, 'node_modules'))).toBe(false)
        }
      } finally {
        removeWorkspaceWithRetry(workspace)
      }
    }
  )

  it('runs dev without install when project has no deps', async ({skip}) => {
    skipUnlessReady(skip)

    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-noinstall-'))
    const projectPath = join(workspace, 'app-dev')
    let devTimedOut = false

    try {
      const createResult = runCommand(
        runner.command,
        runner.buildArgs(packages, [
          'create',
          projectPath,
          '--template',
          'javascript',
          '--install',
          'false'
        ]),
        {cwd: workspace, env: defaultEnv}
      )
      expect(createResult.status).toBe(0)

      const devResult = await runUntilTimeout(
        runner.command,
        runner.buildArgs(packages, [
          'dev',
          projectPath,
          '--no-browser',
          '--install',
          'false'
        ]),
        {cwd: projectPath, env: defaultEnv},
        6000
      )
      devTimedOut = devResult.timedOut

      // Still serving at the deadline is the pass. Either way it printed no error.
      if (!devResult.timedOut) expect([0, 1]).toContain(devResult.status)

      expect(devResult.stderr).not.toContain('Error:')
    } finally {
      cleanupWorkspaceAfterTimedDev(workspace, devTimedOut)
    }
  })

  const installAndBuildTimeoutMs =
    process.platform === 'win32' && runner.name === 'pnpmDlx'
      ? 300_000
      : 120_000

  it(
    'installs local tarballs and can build',
    ({skip}) => {
      skipUnlessReady(skip)

      const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-install-'))
      const projectPath = join(workspace, 'app-build')

      try {
        const createResult = runCommand(
          runner.command,
          runner.buildArgs(packages, [
            'create',
            projectPath,
            '--template',
            'javascript',
            '--install',
            'false'
          ]),
          {cwd: workspace, env: defaultEnv}
        )
        expect(createResult.status).toBe(0)

        const hasNpm = npmCommand !== 'npm'
        const installCmd = hasNpm ? npmCommand : runner.command
        const installArgs =
          installCmd === runner.command
            ? ['add', '--save-dev', cliTgz, createTgz, developTgz]
            : ['install', '--save-dev', cliTgz, createTgz, developTgz]
        const installResult = runCommand(installCmd, installArgs, {
          cwd: projectPath,
          env: baseEnv
        })
        expect(installResult.status).toBe(0)
        expect(existsSync(join(projectPath, 'node_modules'))).toBe(true)

        const buildResult = runCommand(
          runner.command,
          runner.buildArgs(packages, [
            'build',
            projectPath,
            '--silent',
            'true'
          ]),
          {
            cwd: projectPath,
            env: {...defaultEnv, EXTENSION_AUTHOR_MODE: 'true'}
          }
        )
        expect(buildResult.status).toBe(0)
      } finally {
        removeWorkspaceWithRetry(workspace)
      }
    },
    installAndBuildTimeoutMs
  )
})

describe('cli direct flow (no npx)', () => {
  const cliBin = resolveCliBin()

  function runCli(cmdArgs: string[], cwd: string) {
    return runCommand(process.execPath, [cliBin, ...cmdArgs], {
      cwd,
      env: defaultEnv
    })
  }

  it('creates, builds, and previews without npx', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-direct-'))
    const projectPath = join(workspace, 'app-direct')
    let devTimedOut = false

    try {
      const createResult = runCli(
        [
          'create',
          projectPath,
          '--template',
          'javascript',
          '--install',
          'false'
        ],
        workspace
      )
      expect(createResult.status).toBe(0)

      const buildResult = runCli(
        ['build', projectPath, '--silent', 'true', '--install', 'false'],
        projectPath
      )
      expect(buildResult.status).toBe(0)

      const previewResult = runCli(
        ['preview', projectPath, '--no-browser'],
        projectPath
      )
      expect(previewResult.status).toBe(0)

      const devResult = await runUntilTimeout(
        process.execPath,
        [cliBin, 'dev', projectPath, '--no-browser', '--install', 'false'],
        {cwd: projectPath, env: defaultEnv},
        6000
      )
      devTimedOut = devResult.timedOut

      // Still serving at the deadline is the pass. Either way it printed no error.
      if (!devResult.timedOut) expect([0, 1]).toContain(devResult.status)

      expect(devResult.stderr).not.toContain('Error:')
    } finally {
      cleanupWorkspaceAfterTimedDev(workspace, devTimedOut)
    }
  })
})
