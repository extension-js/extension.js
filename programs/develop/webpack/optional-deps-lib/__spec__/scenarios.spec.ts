import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const originalResolve = (require as any).resolve
const originalPlatform = process.platform
let cacheDir = ''

const setPlatform = (value: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true
  })
}

const createSpawn = (
  options: {exitCode?: number; error?: NodeJS.ErrnoException} = {}
) => ({
  on: (event: string, handler: (...args: any[]) => void) => {
    if (event === 'close' && options.exitCode !== undefined) {
      handler(options.exitCode)
    }
    if (event === 'error' && options.error) {
      handler(options.error)
    }
  }
})

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(() => ({status: 0})),
  spawn: vi.fn(() => createSpawn({exitCode: 0}))
}))

vi.mock('../../webpack-lib/check-build-dependencies', () => ({
  findExtensionDevelopRoot: () => null
}))

describe('optional-deps-lib scenario matrix', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(require as any).resolve = vi.fn(() => {
      throw new Error('resolve disabled for test')
    })
    delete (process as any).env.EXTENSION_AUTHOR_MODE
    delete process.env.npm_config_user_agent
    delete process.env.npm_execpath
    delete process.env.NPM_EXEC_PATH
    delete process.env.EXTENSION_JS_PACKAGE_MANAGER
    delete process.env.EXTENSION_JS_PM_EXEC_PATH
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-optlib-cache-'))
    process.env.EXTENSION_JS_CACHE_DIR = cacheDir
  })

  afterEach(() => {
    ;(require as any).resolve = originalResolve
    setPlatform(originalPlatform)
    delete process.env.EXTENSION_JS_CACHE_DIR
    if (cacheDir) {
      fs.rmSync(cacheDir, {recursive: true, force: true})
      cacheDir = ''
    }
  })

  it.each([
    {label: 'linux-npm', userAgent: 'npm', expected: ['install', '--prefix']},
    {label: 'linux-pnpm', userAgent: 'pnpm', expected: ['add', '--dir']},
    {label: 'linux-yarn', userAgent: 'yarn', expected: ['add', '--cwd']},
    {label: 'linux-bun', userAgent: 'bun', expected: ['add', '--cwd']}
  ])('uses expected manager command shape: $label', async (scenario) => {
    process.env.npm_config_user_agent = scenario.userAgent
    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import('../index')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const firstCall = spawn.mock.calls[0]
    const args = Array.isArray(firstCall?.[1]) ? firstCall[1].join(' ') : ''
    for (const token of scenario.expected) {
      expect(args).toContain(token)
    }
  })

  it('uses npm exec path in npx-like environment', async () => {
    process.env.npm_execpath = '/tmp/npm-cli.js'
    const {spawnSync, spawn} = (await import('child_process')) as any
    spawnSync.mockReturnValue({status: 1})

    const {installOptionalDependencies} = await import('../index')
    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    expect(call?.[0]).toBe(process.execPath)
    expect(call?.[1]?.[0]).toBe('/tmp/npm-cli.js')
  })

  it('falls back to corepack+pnpm when no manager is detected', async () => {
    const {spawnSync, spawn, execFileSync} = (await import(
      'child_process'
    )) as any
    spawnSync.mockImplementation((cmd: string) =>
      cmd === 'corepack' ? {status: 0} : {status: 1}
    )
    execFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      const err: NodeJS.ErrnoException = new Error('not found')
      err.code = 'ENOENT'
      throw err
    })
    const original = (require as any).resolve
    ;(require as any).resolve = vi.fn((id: string, opts: any) => {
      if (id === 'npm/bin/npm-cli.js') throw new Error('npm cli not found')
      return original(id, opts)
    })

    const {installOptionalDependencies} = await import('../index')
    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call[1].join(' ') : ''
    expect([call?.[0], args].join(' ')).toContain('corepack')
    expect(args).toContain('pnpm')
    ;(require as any).resolve = original
  })

  it('wraps install with wsl.exe for WSL UNC cache roots on Windows', async () => {
    if (originalPlatform !== 'win32') return

    setPlatform('win32')
    process.env.npm_config_user_agent = 'npm'
    process.env.EXTENSION_JS_CACHE_DIR = '\\\\wsl.localhost\\Ubuntu\\tmp\\extjs'

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import('../index')
    await installOptionalDependencies('React', ['react-refresh'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call[1] : []
    expect(call?.[0]).toBe('wsl.exe')
    expect(args).toContain('--')
    expect(args.join(' ')).toContain('/tmp/extjs/optional-deps')
    expect(call?.[2]?.cwd).toBeUndefined()
  })

  it('force-recreates stale install root when requested', async () => {
    process.env.npm_config_user_agent = 'npm'
    const {installOptionalDependencies, resolveOptionalInstallRoot} =
      await import('../index')

    const installRoot = resolveOptionalInstallRoot()
    fs.mkdirSync(path.join(installRoot, 'node_modules', 'stale-package'), {
      recursive: true
    })
    fs.writeFileSync(path.join(installRoot, 'package-lock.json'), '{}', 'utf8')

    await installOptionalDependencies(
      'React',
      ['react-refresh', '@rspack/plugin-react-refresh'],
      {forceRecreateInstallRoot: true}
    )

    expect(
      fs.existsSync(path.join(installRoot, 'node_modules', 'stale-package'))
    ).toBe(false)
    expect(fs.existsSync(path.join(installRoot, 'package-lock.json'))).toBe(
      false
    )
  })
})
