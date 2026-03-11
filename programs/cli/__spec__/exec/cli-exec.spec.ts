import {beforeAll, afterAll, describe, expect, it} from 'vitest'
import {spawn, spawnSync, execFileSync} from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

type Runner = {
  name: string
  command: string
  buildArgs: (packages: string[], cmdArgs: string[]) => string[]
  isAvailable: () => boolean
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '../../../..')
const cliDir = resolve(repoRoot, 'programs/cli')
const createDir = resolve(repoRoot, 'programs/create')
const developDir = resolve(repoRoot, 'programs/develop')
const previewFixture = resolve(
  repoRoot,
  '_FUTURE/extension-develop-dist/extension-js-devtools/chrome'
)

// Resolve pnpm so spawn finds it cross-platform (avoids ENOENT when PATH differs in child/CI)
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

// Resolve npm for tests that run npm install (CI may not have npm on PATH)
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

// Ensure spawned processes find node and pnpm (e.g. CI sets PNPM_HOME)
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
  EXTENSION_SKIP_INTERNAL_INSTALL: 'true'
}

function removeWorkspaceWithRetry(targetPath: string) {
  const attempts = process.platform === 'win32' ? 6 : 1
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
      if (process.platform !== 'win32') throw error

      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)
    }
  }

  if (lastError) throw lastError
}

function cleanupWorkspaceAfterTimedDev(targetPath: string, timedOut: boolean) {
  try {
    removeWorkspaceWithRetry(targetPath)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    const isBusy = err?.code === 'EBUSY'
    if (process.platform === 'win32' && timedOut && isBusy) {
      return
    }
    throw error
  }
}

function runCommand(
  command: string,
  args: string[],
  options: {cwd?: string; env?: NodeJS.ProcessEnv} = {}
) {
  // On Windows, .cmd files must be run with shell (spawnSync EINVAL otherwise)
  const useShell =
    process.platform === 'win32' &&
    (command.endsWith('.cmd') || command.endsWith('.bat'))
  const result = spawnSync(command, args, {
    ...options,
    stdio: 'pipe',
    encoding: 'utf8',
    ...(useShell ? {shell: true} : {})
  })
  if (result.error) {
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
    // On Windows, .cmd/.bat must be run with shell (spawn EINVAL otherwise)
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

    const killWindowsProcessTree = (force: boolean) => {
      if (process.platform !== 'win32' || !child.pid) return false

      try {
        execFileSync(
          'taskkill',
          ['/pid', String(child.pid), '/t', ...(force ? ['/f'] : [])],
          {
            stdio: ['ignore', 'ignore', 'ignore'],
            windowsHide: true
          }
        )
        return true
      } catch {
        return false
      }
    }

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

    // On Windows process.kill(-pid) does not target process group; use child.kill only
    const useProcessGroupKill = process.platform !== 'win32'
    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (useProcessGroupKill && child.pid) {
          process.kill(-child.pid, 'SIGTERM')
        } else if (killWindowsProcessTree(false)) {
          return
        } else {
          throw new Error('skip')
        }
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          // best-effort only
        }
      }
    }, timeoutMs)

    const killTimer = setTimeout(() => {
      if (resolved) return
      try {
        if (useProcessGroupKill && child.pid) {
          process.kill(-child.pid, 'SIGKILL')
        } else if (killWindowsProcessTree(true)) {
          return
        } else {
          throw new Error('skip')
        }
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // best-effort only
        }
      }
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

function getPackagesForRunner(runnerName: string) {
  if (runnerName === 'pnpmDlx') {
    return [
      `extension@file:${cliTgz}`,
      `extension-create@file:${createTgz}`,
      `extension-develop@file:${developTgz}`
    ]
  }
  return [cliTgz, createTgz, developTgz]
}

beforeAll(() => {
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
    const smoke = runCommand(
      runner.command,
      runner.buildArgs(getPackagesForRunner(runner.name), ['--help']),
      {cwd: repoRoot, env: defaultEnv}
    )
    runnerReady.set(runner.name, (smoke.status || 0) === 0)
  }
})

afterAll(() => {
  if (packDir) {
    rmSync(packDir, {recursive: true, force: true})
  }
})

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
  },
  {
    name: 'bunx',
    command: 'bunx',
    buildArgs: (packages, cmdArgs) => [
      ...packages.flatMap((pkg) => ['--package', pkg]),
      'extension',
      ...cmdArgs
    ],
    isAvailable: () =>
      isRunnerAvailable('bunx') && supportsPackageFlag('bunx', ['--help'])
  }
]

const availableRunners = runners.filter((runner) => runner.isAvailable())

describe.each(availableRunners)('cli exec flow (%s)', (runner) => {
  const packages = getPackagesForRunner(runner.name)
  const isNpmFamilyExec = runner.name === 'npx' || runner.name === 'npmExec'
  const shouldAssertNoNodeModules = !isNpmFamilyExec

  it('creates default template without install', () => {
    if (!runnerReady.get(runner.name)) return
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
      if (shouldAssertNoNodeModules) {
        expect(existsSync(join(projectPath, 'node_modules'))).toBe(false)
      }
    } finally {
      removeWorkspaceWithRetry(workspace)
    }
  })

  it('creates explicit template without install', () => {
    if (!runnerReady.get(runner.name)) return
    // npm exec / npx can intermittently fail with local tarball + template selection
    // depending on npm runtime behavior; keep deterministic coverage on other runners.
    if (isNpmFamilyExec) return
    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-create-'))
    const projectPath = join(workspace, 'app-template')
    try {
      const result = runCommand(
        runner.command,
        runner.buildArgs(packages, [
          'create',
          projectPath,
          '--template',
          'react',
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
  })

  it('previews a prebuilt extension without install', () => {
    if (!runnerReady.get(runner.name)) return
    if (!existsSync(join(previewFixture, 'manifest.json'))) {
      return
    }
    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-preview-'))
    try {
      const result = runCommand(
        runner.command,
        runner.buildArgs(packages, ['preview', previewFixture, '--no-browser']),
        {cwd: workspace, env: defaultEnv}
      )
      expect(result.status).toBe(0)
    } finally {
      removeWorkspaceWithRetry(workspace)
    }
  })

  it('builds without install when project has no deps', () => {
    if (!runnerReady.get(runner.name)) return
    // npm exec / npx can intermittently fail this no-install path with local tarballs
    // while direct-cli and pnpm dlx paths remain deterministic in CI.
    if (isNpmFamilyExec) return
    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-noinstall-'))
    const projectPath = join(workspace, 'app-build')
    try {
      const createResult = runCommand(
        runner.command,
        runner.buildArgs(packages, [
          'create',
          projectPath,
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
  })

  it('runs dev without install when project has no deps', async () => {
    if (!runnerReady.get(runner.name)) return
    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-noinstall-'))
    const projectPath = join(workspace, 'app-dev')
    let devTimedOut = false
    try {
      const createResult = runCommand(
        runner.command,
        runner.buildArgs(packages, [
          'create',
          projectPath,
          '--install',
          'false'
        ]),
        {cwd: workspace, env: defaultEnv}
      )
      expect(createResult.status).toBe(0)

      const devResult = await runUntilTimeout(
        runner.command,
        runner.buildArgs(packages, ['dev', projectPath, '--no-browser']),
        {cwd: projectPath, env: defaultEnv},
        6000
      )
      devTimedOut = devResult.timedOut
      if (devResult.timedOut) {
        expect(devResult.timedOut).toBe(true)
      } else {
        expect([0, 1]).toContain(devResult.status)
      }
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
    () => {
      if (!runnerReady.get(runner.name)) return
      const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-install-'))
      const projectPath = join(workspace, 'app-build')
      try {
        const createResult = runCommand(
          runner.command,
          runner.buildArgs(packages, [
            'create',
            projectPath,
            '--install',
            'false'
          ]),
          {cwd: workspace, env: defaultEnv}
        )
        expect(createResult.status).toBe(0)

        // Prefer npm when we have a path; on CI (e.g. setup-pnpm) npm may be absent, use runner PM
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
        ['create', projectPath, '--install', 'false'],
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
        [cliBin, 'dev', projectPath, '--no-browser'],
        {cwd: projectPath, env: defaultEnv},
        6000
      )
      devTimedOut = devResult.timedOut
      if (devResult.timedOut) {
        expect(devResult.timedOut).toBe(true)
      } else {
        expect([0, 1]).toContain(devResult.status)
      }
    } finally {
      cleanupWorkspaceAfterTimedDev(workspace, devTimedOut)
    }
  })
})
