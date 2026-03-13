import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'

const originalResolve = (require as any).resolve
const originalPlatform = process.platform

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

describe('css-lib integrations', () => {
  const mockDevelopRoot = async (extraExistingPaths: string[] = []) => {
    const isDevelopPackageJson = (p: string) =>
      p.endsWith(`${path.sep}programs${path.sep}develop${path.sep}package.json`)
    const extraPaths = new Set(extraExistingPaths)

    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) =>
          isDevelopPackageJson(p) || extraPaths.has(p) || actual.existsSync(p),
        readFileSync: (p: string) => {
          if (isDevelopPackageJson(p)) {
            return JSON.stringify({name: 'extension-develop'})
          }
          return actual.readFileSync(p)
        }
      }
    })
  }

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
    process.env.EXTENSION_JS_CACHE_DIR = '/tmp/extjs-cache'
  })

  afterEach(() => {
    ;(require as any).resolve = originalResolve
    setPlatform(originalPlatform)
    delete process.env.EXTENSION_JS_CACHE_DIR
  })

  it('installs optional tooling into isolated cache root', async () => {
    let resolvedRoot: string | undefined
    await mockDevelopRoot()

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(spawn).toHaveBeenCalled()
    const call = spawn.mock.calls[0]
    resolvedRoot = call?.[2]?.cwd
    expect(resolvedRoot).toContain(`${path.sep}optional-deps${path.sep}`)
  })

  it('keeps single-package installs to a single command', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'npm'

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('installs peer-heavy Vue deps together and relinks the cache root', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'npm'

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('Vue', [
      'vue-loader',
      '@vue/compiler-sfc',
      'vue'
    ])

    expect(spawn).toHaveBeenCalledTimes(2)

    const installArgs = Array.isArray(spawn.mock.calls[0]?.[1])
      ? spawn.mock.calls[0][1].join(' ')
      : ''
    expect(installArgs).toContain('vue-loader')
    expect(installArgs).toContain('@vue/compiler-sfc')
    expect(installArgs).toContain('vue@')

    const relinkArgs = Array.isArray(spawn.mock.calls[1]?.[1])
      ? spawn.mock.calls[1][1].join(' ')
      : ''
    expect(relinkArgs).toContain('install')
    expect(relinkArgs).not.toContain('vue-loader')
    expect(relinkArgs).not.toContain('@vue/compiler-sfc')
  })

  it('relinks peer-heavy Vue installs for pnpm consumers too', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'pnpm'

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('Vue', [
      'vue-loader',
      '@vue/compiler-sfc',
      'vue'
    ])

    expect(spawn).toHaveBeenCalledTimes(2)

    const installArgs = Array.isArray(spawn.mock.calls[0]?.[1])
      ? spawn.mock.calls[0][1].join(' ')
      : ''
    expect(installArgs).toContain('add')
    expect(installArgs).toContain('--dir')
    expect(installArgs).toContain('vue-loader')
    expect(installArgs).toContain('@vue/compiler-sfc')
    expect(installArgs).toContain('vue@')

    const relinkArgs = Array.isArray(spawn.mock.calls[1]?.[1])
      ? spawn.mock.calls[1][1].join(' ')
      : ''
    expect(relinkArgs).toContain('install')
    expect(relinkArgs).toContain('--lockfile=false')
    expect(relinkArgs).not.toContain('vue-loader')
  })

  it('uses pnpm add with --dir and --save-optional', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'pnpm'

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call?.[1].join(' ') : ''
    if (process.platform === 'win32') {
      expect(
        [call?.[0], args].some(
          (v) => /cmd\.exe$/i.test(String(v)) || String(v).includes('pnpm')
        )
      ).toBe(true)
    } else {
      expect(call?.[0]).toBe('pnpm')
    }
    expect(args).toContain('add')
    expect(args).toContain('--dir')
    expect(args).toContain('--save-optional')
    expect(args).toContain('--ignore-workspace')
    expect(args).toContain('--lockfile=false')
    expect(args).toContain('postcss@8.5.6')
    expect(args).not.toContain('--cwd')
  })

  it('prefers env package manager even when command check fails', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'pnpm'

    const {spawnSync, spawn} = (await import('child_process')) as any
    spawnSync.mockReturnValueOnce({status: 1})

    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call?.[1].join(' ') : ''
    if (process.platform === 'win32') {
      expect(
        [call?.[0], args].some(
          (v) => /cmd\.exe$/i.test(String(v)) || String(v).includes('pnpm')
        )
      ).toBe(true)
    } else {
      expect(call?.[0]).toBe('pnpm')
    }
  })

  it('falls back to npm cli when env manager is missing', async () => {
    await mockDevelopRoot(['/tmp/npm-cli.js'])
    process.env.npm_config_user_agent = 'pnpm'
    process.env.EXTENSION_JS_PM_EXEC_PATH = '/tmp/npm-cli.js'

    const {spawn} = (await import('child_process')) as any
    const missingManager: NodeJS.ErrnoException = new Error('spawn pnpm ENOENT')
    missingManager.code = 'ENOENT'
    spawn.mockImplementationOnce(() => createSpawn({error: missingManager}))

    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(spawn).toHaveBeenCalledTimes(2)
    const fallbackCall = spawn.mock.calls[1]
    expect(fallbackCall?.[0]).toBe(process.execPath)
    expect(fallbackCall?.[1]?.[0]).toBe('/tmp/npm-cli.js')
  })

  it('falls back to npm cli when manager exits with non-zero code', async () => {
    await mockDevelopRoot(['/tmp/npm-cli.js'])
    process.env.EXTENSION_JS_PACKAGE_MANAGER = 'pnpm'
    process.env.EXTENSION_JS_PM_EXEC_PATH = '/tmp/npm-cli.js'

    const {spawn} = (await import('child_process')) as any
    spawn.mockImplementationOnce(() => createSpawn({exitCode: 1}))

    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('React', ['react-refresh'])

    expect(spawn).toHaveBeenCalledTimes(2)
    const fallbackCall = spawn.mock.calls[1]
    expect(fallbackCall?.[0]).toBe(process.execPath)
    expect(fallbackCall?.[1]?.[0]).toBe('/tmp/npm-cli.js')
  })

  it('falls back to npm cli on Windows when manager exits with non-zero code', async () => {
    setPlatform('win32')
    await mockDevelopRoot(['/tmp/npm-cli.js'])
    process.env.EXTENSION_JS_PACKAGE_MANAGER = 'pnpm'
    process.env.EXTENSION_JS_PM_EXEC_PATH = '/tmp/npm-cli.js'

    const {spawn} = (await import('child_process')) as any
    spawn.mockImplementationOnce(() => createSpawn({exitCode: 1}))

    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('React', ['react-refresh'])

    expect(spawn).toHaveBeenCalledTimes(2)
    const fallbackCall = spawn.mock.calls[1]
    expect(fallbackCall?.[0]).toBe(process.execPath)
    const fallbackArgs = Array.isArray(fallbackCall?.[1]) ? fallbackCall[1] : []
    expect(fallbackArgs[0]).toBe('/tmp/npm-cli.js')
    expect(fallbackArgs.join(' ')).toContain('install')
    expect(fallbackArgs.join(' ')).toContain('--save-optional')
    expect(fallbackArgs.join(' ')).toContain('react-refresh@0.18.0')
  })

  it('does not fallback on Windows when primary manager is npm', async () => {
    setPlatform('win32')
    await mockDevelopRoot(['/tmp/npm-cli.js'])
    process.env.npm_config_user_agent = 'npm'
    process.env.EXTENSION_JS_PM_EXEC_PATH = '/tmp/npm-cli.js'

    const {spawn} = (await import('child_process')) as any
    spawn.mockImplementationOnce(() => createSpawn({exitCode: 1}))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(spawn).toHaveBeenCalledTimes(1)
    const combinedErrors = errorSpy.mock.calls
      .map((call) => String(call?.[0] || ''))
      .join('\n')
    expect(combinedErrors).toContain('Failed to install dependencies')
    errorSpy.mockRestore()
  })

  it('uses EXTENSION_JS_PACKAGE_MANAGER override when provided', async () => {
    await mockDevelopRoot()
    process.env.EXTENSION_JS_PACKAGE_MANAGER = 'yarn'

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call?.[1].join(' ') : ''
    if (process.platform === 'win32') {
      expect(
        [call?.[0], args].some(
          (v) => /cmd\.exe$/i.test(String(v)) || String(v).includes('yarn')
        )
      ).toBe(true)
    } else {
      expect(call?.[0]).toBe('yarn')
    }
  })

  it('wraps EXTENSION_JS_PM_EXEC_PATH when no manager is in PATH', async () => {
    await mockDevelopRoot()
    process.env.EXTENSION_JS_PM_EXEC_PATH = '/tmp/npm-cli.js'

    const {spawnSync, spawn} = (await import('child_process')) as any
    spawnSync.mockReturnValue({status: 1})

    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    expect(call?.[0]).toBe(process.execPath)
    expect(call?.[1]?.[0]).toBe('/tmp/npm-cli.js')
  })

  it('wraps npm_execpath when no manager is in PATH', async () => {
    await mockDevelopRoot()
    process.env.npm_execpath = '/tmp/npm-cli.js'

    const {spawnSync, spawn} = (await import('child_process')) as any
    spawnSync.mockReturnValue({status: 1})

    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    expect(call?.[0]).toBe(process.execPath)
    expect(call?.[1]?.[0]).toBe('/tmp/npm-cli.js')
  })

  it('uses corepack fallback when no manager is available', async () => {
    await mockDevelopRoot()

    const {spawnSync, spawn, execFileSync} = (await import(
      'child_process'
    )) as any
    spawnSync.mockImplementation((cmd: string) =>
      cmd === 'corepack' ? {status: 0} : {status: 1}
    )
    execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      const joined = Array.isArray(args) ? args.join(' ') : String(args || '')
      if (joined.trim() === 'corepack') return 'C:\\corepack\\corepack.cmd'
      const err: NodeJS.ErrnoException = new Error('not found')
      err.code = 'ENOENT'
      throw err
    })
    const originalResolve = (require as any).resolve
    ;(require as any).resolve = vi.fn((id: string, opts: any) => {
      if (id === 'npm/bin/npm-cli.js') {
        throw new Error('npm cli not found')
      }
      return originalResolve(id, opts)
    })

    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call?.[1] : []
    const argsStr = args.join(' ')
    if (process.platform === 'win32') {
      expect(
        [call?.[0], argsStr].some(
          (v) =>
            /cmd\.exe$/i.test(String(v)) ||
            String(v).includes('corepack') ||
            String(v).includes('pnpm')
        )
      ).toBe(true)
    } else {
      expect(
        ['corepack', 'pnpm', 'npm-cli.js'].some((token) =>
          [call?.[0], argsStr].join(' ').includes(token)
        )
      ).toBe(true)
    }
    expect(['pnpm', 'install'].some((token) => argsStr.includes(token))).toBe(
      true
    )
    ;(require as any).resolve = originalResolve
  })

  it('falls back to npm when nothing is detected', async () => {
    await mockDevelopRoot()

    const {spawnSync, spawn, execFileSync} = (await import(
      'child_process'
    )) as any
    spawnSync.mockReturnValue({status: 1})
    execFileSync.mockImplementation(() => {
      const err: NodeJS.ErrnoException = new Error('not found')
      err.code = 'ENOENT'
      throw err
    })
    const originalResolve = (require as any).resolve
    ;(require as any).resolve = vi.fn((id: string, opts: any) => {
      if (id === 'npm/bin/npm-cli.js') {
        throw new Error('npm cli not found')
      }
      return originalResolve(id, opts)
    })

    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call?.[1].join(' ') : ''
    if (process.platform === 'win32') {
      expect(
        [call?.[0], args].some(
          (v) => /cmd\.exe$/i.test(String(v)) || String(v).includes('npm')
        )
      ).toBe(true)
    } else {
      expect([call?.[0], args].join(' ')).toContain('npm')
    }
    ;(require as any).resolve = originalResolve
  })

  it('uses npm install with --prefix and --save-optional', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'npm'

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call?.[1].join(' ') : ''
    if (process.platform === 'win32') {
      expect(
        [call?.[0], args].some(
          (v) => /cmd\.exe$/i.test(String(v)) || String(v).includes('npm')
        )
      ).toBe(true)
    } else {
      expect(call?.[0]).toBe('npm')
    }
    expect(args).toContain('install')
    expect(args).toContain('--prefix')
    expect(args).toContain('--save-optional')
    expect(args).toContain('postcss@8.5.6')
  })

  it('uses yarn add with --cwd and --optional', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'yarn'

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call?.[1].join(' ') : ''
    if (process.platform === 'win32') {
      expect(
        [call?.[0], args].some(
          (v) => /cmd\.exe$/i.test(String(v)) || String(v).includes('yarn')
        )
      ).toBe(true)
    } else {
      expect(call?.[0]).toBe('yarn')
    }
    expect(args).toContain('add')
    expect(args).toContain('--cwd')
    expect(args).toContain('--optional')
    expect(args).toContain('postcss@8.5.6')
  })

  it('uses bun add with --cwd and --optional', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'bun'

    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = spawn.mock.calls[0]
    const args = Array.isArray(call?.[1]) ? call?.[1].join(' ') : ''
    if (process.platform === 'win32') {
      expect(
        [call?.[0], args].some(
          (v) => /cmd\.exe$/i.test(String(v)) || String(v).includes('bun')
        )
      ).toBe(true)
    } else {
      expect(call?.[0]).toBe('bun')
    }
    expect(args).toContain('add')
    expect(args).toContain('--cwd')
    expect(args).toContain('--optional')
    expect(args).toContain('postcss@8.5.6')
  })
})
