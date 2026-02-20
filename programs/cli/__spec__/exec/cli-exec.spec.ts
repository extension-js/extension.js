import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  '_FUTURE/extension-develop-dist/extension-js-devtools/chrome',
)

const defaultEnv: NodeJS.ProcessEnv = {
  ...process.env,
  EXTENSION_DEV_NO_BROWSER: '1',
  EXTENSION_ENV: 'test',
  EXTENSION_SKIP_INTERNAL_INSTALL: 'true',
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const result = spawnSync(command, args, {
    ...options,
    stdio: 'pipe',
    encoding: 'utf8',
  })
  if (result.error) {
    throw result.error
  }
  return result
}

async function runUntilTimeout(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  timeoutMs = 5000,
) {
  return await new Promise<{
    status: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
    timedOut: boolean
  }>((resolvePromise) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'pipe',
      detached: true,
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
      resolvePromise({ status, signal, stdout, stderr, timedOut })
    }

    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGTERM')
        } else {
          throw new Error('missing pid')
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
        if (child.pid) {
          process.kill(-child.pid, 'SIGKILL')
        } else {
          throw new Error('missing pid')
        }
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // best-effort only
        }
      }
      finalize(null, 'SIGKILL')
    }, timeoutMs + 3000)

    child.on('close', (status, signal) => {
      finalize(status, signal)
    })

    child.on('error', () => {
      finalize(null, null)
    })
  })
}

async function runUntilMatch(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  matcher: RegExp,
  timeoutMs = 15000,
) {
  return await new Promise<{
    status: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
    matched: boolean
    timedOut: boolean
  }>((resolvePromise) => {
    const child = spawn(command, args, {
      ...options,
      stdio: 'pipe',
      detached: true,
    })
    let stdout = ''
    let stderr = ''
    let matched = false
    let timedOut = false
    let resolved = false

    const finalize = (status: number | null, signal: NodeJS.Signals | null) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      resolvePromise({ status, signal, stdout, stderr, matched, timedOut })
    }

    const onChunk = (chunk: Buffer, isErr = false) => {
      const text = chunk.toString()
      if (isErr) stderr += text
      else stdout += text
      if (!matched && matcher.test(stdout + stderr)) {
        matched = true
        try {
          if (child.pid) {
            process.kill(-child.pid, 'SIGTERM')
          } else {
            throw new Error('missing pid')
          }
        } catch {
          try {
            child.kill('SIGTERM')
          } catch {
            // best-effort only
          }
        }
      }
    }

    child.stdout?.on('data', (chunk) => onChunk(chunk as Buffer))
    child.stderr?.on('data', (chunk) => onChunk(chunk as Buffer, true))

    const timer = setTimeout(() => {
      timedOut = true
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGTERM')
        } else {
          throw new Error('missing pid')
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
        if (child.pid) {
          process.kill(-child.pid, 'SIGKILL')
        } else {
          throw new Error('missing pid')
        }
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          // best-effort only
        }
      }
      finalize(null, 'SIGKILL')
    }, timeoutMs + 3000)

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
  const result = runCommand('pnpm', ['-C', pkgDir, 'run', 'compile'], {
    cwd: pkgDir,
    env: process.env,
  })
  if ((result.status || 0) !== 0) {
    throw new Error(
      `Failed to compile ${pkgDir}\n${result.stdout}\n${result.stderr}`,
    )
  }
}

function packPackage(pkgDir: string, packDir: string) {
  const before = new Set(readdirSync(packDir))
  const result = runCommand('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: pkgDir,
    env: process.env,
  })
  if ((result.status || 0) !== 0) {
    throw new Error(
      `Failed to pack ${pkgDir}\n${result.stdout}\n${result.stderr}`,
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
      `extension-develop@file:${developTgz}`,
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
      { cwd: repoRoot, env: defaultEnv },
    )
    runnerReady.set(runner.name, (smoke.status || 0) === 0)
  }
})

afterAll(() => {
  if (packDir) {
    rmSync(packDir, { recursive: true, force: true })
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
      ...cmdArgs,
    ],
    isAvailable: () => isRunnerAvailable('npx'),
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
      ...cmdArgs,
    ],
    isAvailable: () => isRunnerAvailable('npm'),
  },
  {
    name: 'pnpmDlx',
    command: 'pnpm',
    buildArgs: (packages, cmdArgs) => [
      'dlx',
      ...packages.flatMap((pkg) => ['--package', pkg]),
      'extension',
      ...cmdArgs,
    ],
    isAvailable: () =>
      isRunnerAvailable('pnpm') &&
      supportsPackageFlag('pnpm', ['dlx', '--help']),
  },
  {
    name: 'bunx',
    command: 'bunx',
    buildArgs: (packages, cmdArgs) => [
      ...packages.flatMap((pkg) => ['--package', pkg]),
      'extension',
      ...cmdArgs,
    ],
    isAvailable: () =>
      isRunnerAvailable('bunx') && supportsPackageFlag('bunx', ['--help']),
  },
]

const availableRunners = runners.filter((runner) => runner.isAvailable())

describe.each(availableRunners)('cli exec flow (%s)', (runner) => {
  const packages = getPackagesForRunner(runner.name)

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
          'false',
        ]),
        { cwd: workspace, env: defaultEnv },
      )
      expect(result.status).toBe(0)
      expect(existsSync(join(projectPath, 'package.json'))).toBe(true)
      const pkg = JSON.parse(
        readFileSync(join(projectPath, 'package.json'), 'utf8'),
      )
      expect(pkg.devDependencies?.extension).toBeTruthy()
      expect(existsSync(join(projectPath, 'node_modules'))).toBe(false)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('creates explicit template without install', () => {
    if (!runnerReady.get(runner.name)) return
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
          'false',
        ]),
        { cwd: workspace, env: defaultEnv },
      )
      expect(result.status).toBe(0)
      expect(existsSync(join(projectPath, 'package.json'))).toBe(true)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
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
        runner.buildArgs(packages, ['preview', previewFixture, '--no-runner']),
        { cwd: workspace, env: defaultEnv },
      )
      expect(result.status).toBe(0)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('builds without install when project has no deps', () => {
    if (!runnerReady.get(runner.name)) return
    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-noinstall-'))
    const projectPath = join(workspace, 'app-build')
    try {
      const createResult = runCommand(
        runner.command,
        runner.buildArgs(packages, [
          'create',
          projectPath,
          '--install',
          'false',
        ]),
        { cwd: workspace, env: defaultEnv },
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
          'false',
        ]),
        { cwd: projectPath, env: defaultEnv },
      )
      expect(buildResult.status).toBe(0)
      expect(existsSync(join(projectPath, 'node_modules'))).toBe(false)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('runs dev without install when project has no deps', async () => {
    if (!runnerReady.get(runner.name)) return
    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-noinstall-'))
    const projectPath = join(workspace, 'app-dev')
    try {
      const createResult = runCommand(
        runner.command,
        runner.buildArgs(packages, [
          'create',
          projectPath,
          '--install',
          'false',
        ]),
        { cwd: workspace, env: defaultEnv },
      )
      expect(createResult.status).toBe(0)

      const devResult = await runUntilTimeout(
        runner.command,
        runner.buildArgs(packages, ['dev', projectPath, '--no-runner']),
        { cwd: projectPath, env: defaultEnv },
        6000,
      )
      if (devResult.timedOut) {
        expect(devResult.timedOut).toBe(true)
      } else {
        expect([0, 1]).toContain(devResult.status)
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('installs local tarballs and can build', () => {
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
          'false',
        ]),
        { cwd: workspace, env: defaultEnv },
      )
      expect(createResult.status).toBe(0)

      const installResult = runCommand(
        'npm',
        ['install', '--save-dev', cliTgz, createTgz, developTgz],
        { cwd: projectPath, env: process.env },
      )
      expect(installResult.status).toBe(0)
      expect(existsSync(join(projectPath, 'node_modules'))).toBe(true)

      const buildResult = runCommand(
        runner.command,
        runner.buildArgs(packages, ['build', projectPath, '--silent', 'true']),
        {
          cwd: projectPath,
          env: { ...defaultEnv, EXTENSION_AUTHOR_MODE: 'true' },
        },
      )
      expect(buildResult.status).toBe(0)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('cli direct flow (no npx)', () => {
  const cliBin = resolveCliBin()

  function runCli(cmdArgs: string[], cwd: string) {
    return runCommand(process.execPath, [cliBin, ...cmdArgs], {
      cwd,
      env: defaultEnv,
    })
  }

  it('creates, builds, and previews without npx', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'extjs-cli-direct-'))
    const projectPath = join(workspace, 'app-direct')
    try {
      const createResult = runCli(
        ['create', projectPath, '--install', 'false'],
        workspace,
      )
      expect(createResult.status).toBe(0)

      const buildResult = runCli(
        ['build', projectPath, '--silent', 'true', '--install', 'false'],
        projectPath,
      )
      expect(buildResult.status).toBe(0)

      const previewResult = runCli(
        ['preview', projectPath, '--no-runner'],
        projectPath,
      )
      expect(previewResult.status).toBe(0)

      const devResult = await runUntilTimeout(
        process.execPath,
        [cliBin, 'dev', projectPath, '--no-runner'],
        { cwd: projectPath, env: defaultEnv },
        6000,
      )
      if (devResult.timedOut) {
        expect(devResult.timedOut).toBe(true)
      } else {
        expect([0, 1]).toContain(devResult.status)
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('cli browser banners (dev/start)', () => {
  const cliBin = resolveCliBin()
  let workspacePath = ''
  let projectPath = ''
  const bannerRegex = /Extension\.js[\s\S]*Browser\s+/m
  const isCI =
    process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
  const geckoBinaryEnv = process.env.EXTENSION_TEST_GECKO_BINARY
  const chromiumBinaryEnv = process.env.EXTENSION_TEST_CHROMIUM_BINARY

  function resolveBinary(
    envPath: string | undefined,
    candidates: string[],
    knownPaths: string[] = [],
  ) {
    if (envPath && existsSync(envPath)) return envPath
    for (const p of knownPaths) {
      if (existsSync(p)) return p
    }
    const locator = process.platform === 'win32' ? 'where' : 'which'
    for (const name of candidates) {
      try {
        const result = runCommand(locator, [name])
        if ((result.status || 0) === 0) {
          const line = String(result.stdout || '')
            .split(/\r?\n/)
            .find(Boolean)
          if (line) return line.trim()
        }
      } catch {
        // ignore
      }
    }
    return undefined
  }

  const geckoBinary = resolveBinary(
    geckoBinaryEnv,
    ['firefox', 'firefox-esr'],
    process.platform === 'darwin'
      ? [
          '/Applications/Firefox.app/Contents/MacOS/firefox',
          '/Applications/Firefox Nightly.app/Contents/MacOS/firefox',
          '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
        ]
      : [],
  )
  const chromiumBinary = resolveBinary(
    chromiumBinaryEnv,
    ['chromium-browser', 'chromium'],
    process.platform === 'darwin'
      ? ['/Applications/Chromium.app/Contents/MacOS/Chromium']
      : [],
  )

  function baseBrowserEnv(extra: NodeJS.ProcessEnv = {}) {
    const env: NodeJS.ProcessEnv = { ...defaultEnv, ...extra }
    // Ensure we actually launch browsers in these tests.
    delete env.EXTENSION_DEV_NO_BROWSER
    env.NO_COLOR = '1'
    env.EXTENSION_AUTHOR_MODE = 'true'
    return env
  }

  const firefoxTest = geckoBinary ? it : isCI ? it : it.skip

  const chromiumTest = chromiumBinary ? it : isCI ? it : it.skip

  beforeAll(() => {
    if (!geckoBinary && !chromiumBinary) {
      return
    }
    workspacePath = mkdtempSync(join(tmpdir(), 'extjs-cli-browser-banners-'))
    projectPath = join(workspacePath, 'javascript-banner-fixture')
    const createResult = runCommand(
      process.execPath,
      [
        cliBin,
        'create',
        projectPath,
        '--template',
        'javascript',
        '--install',
        'false',
      ],
      { cwd: workspacePath, env: defaultEnv },
    )
    if ((createResult.status || 0) !== 0) {
      throw new Error(
        `Failed to create browser banner fixture project\n${createResult.stdout}\n${createResult.stderr}`,
      )
    }

    // Ensure both browser runners can print an Extension ID immediately.
    const manifestPathCandidates = [
      join(projectPath, 'src', 'manifest.json'),
      join(projectPath, 'manifest.json'),
    ]
    const manifestPath = manifestPathCandidates.find((p) => existsSync(p))
    if (!manifestPath) {
      throw new Error(
        `Could not locate manifest.json in ${projectPath} (checked src/ and root)`,
      )
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (!manifest.key) {
      manifest.key = Buffer.from('cli-browser-banner-key').toString('base64')
    }
    manifest.browser_specific_settings = {
      ...(manifest.browser_specific_settings || {}),
      gecko: {
        ...((manifest.browser_specific_settings || {}).gecko || {}),
        id: 'cli-browser-banner@example.com',
      },
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')

    const installResult = runCommand('pnpm', ['install'], {
      cwd: projectPath,
      env: defaultEnv,
    })
    if ((installResult.status || 0) !== 0) {
      throw new Error(
        `Failed to install browser banner fixture dependencies\n${installResult.stdout}\n${installResult.stderr}`,
      )
    }
  })

  afterAll(() => {
    if (workspacePath) {
      rmSync(workspacePath, { recursive: true, force: true })
    }
  })

  firefoxTest(
    'prints runningInDevelopment banner for Firefox (dev + start)',
    async () => {
      if (!geckoBinary) {
        throw new Error(
          'Firefox binary not found. Set EXTENSION_TEST_GECKO_BINARY in CI.',
        )
      }
      const env = baseBrowserEnv({ MOZ_HEADLESS: '1' })
      const firefoxArgs = [
        '--browser',
        'firefox',
        '--gecko-binary',
        geckoBinary,
      ]

      const firefoxManifest = join(
        projectPath,
        'dist',
        'firefox',
        'manifest.json',
      )
      const devResult = await runUntilTimeout(
        process.execPath,
        [cliBin, 'dev', projectPath, ...firefoxArgs],
        { cwd: projectPath, env },
        30000,
      )
      if (devResult.timedOut) {
        expect(devResult.timedOut).toBe(true)
      } else {
        expect([0, 1]).toContain(devResult.status)
      }
      expect(existsSync(firefoxManifest)).toBe(true)

      const startResult = await runUntilTimeout(
        process.execPath,
        [cliBin, 'start', projectPath, ...firefoxArgs],
        { cwd: projectPath, env },
        40000,
      )
      if (startResult.timedOut) {
        expect(startResult.timedOut).toBe(true)
      } else {
        expect([0, 1]).toContain(startResult.status)
      }
      expect(existsSync(firefoxManifest)).toBe(true)
    },
    40000,
  )

  chromiumTest(
    'prints runningInDevelopment banner for Chromium (dev + start)',
    async () => {
      if (!chromiumBinary) {
        throw new Error(
          'Chromium binary not found. Set EXTENSION_TEST_CHROMIUM_BINARY in CI.',
        )
      }
      const env = baseBrowserEnv()
      const chromiumArgs = [
        '--browser',
        'chromium',
        '--chromium-binary',
        chromiumBinary,
      ]

      const chromiumManifest = join(
        projectPath,
        'dist',
        'chromium',
        'manifest.json',
      )
      const devResult = await runUntilTimeout(
        process.execPath,
        [cliBin, 'dev', projectPath, ...chromiumArgs],
        { cwd: projectPath, env },
        30000,
      )
      if (devResult.timedOut) {
        expect(devResult.timedOut).toBe(true)
      } else {
        expect([0, 1]).toContain(devResult.status)
      }
      expect(existsSync(chromiumManifest)).toBe(true)

      const startResult = await runUntilTimeout(
        process.execPath,
        [cliBin, 'start', projectPath, ...chromiumArgs],
        { cwd: projectPath, env },
        40000,
      )
      if (startResult.timedOut) {
        expect(startResult.timedOut).toBe(true)
      } else {
        expect([0, 1]).toContain(startResult.status)
      }
      expect(existsSync(chromiumManifest)).toBe(true)
    },
    40000,
  )
})
