import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'

const originalResolve = (require as any).resolve

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
        existsSync: (p: string) => isDevelopPackageJson(p) || extraPaths.has(p),
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
  })

  afterEach(() => {
    ;(require as any).resolve = originalResolve
  })

  it('installs optional tooling into extension-develop root', async () => {
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
    expect(resolvedRoot).toContain(`${path.sep}programs${path.sep}develop`)
  })

  it('fails with a clear error when root cannot be resolved', async () => {
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: actual.readFileSync
      }
    })

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const {spawn} = (await import('child_process')) as any
    const {installOptionalDependencies} = await import(
      '../../css-lib/integrations'
    )

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(spawn).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    const combinedErrors = errorSpy.mock.calls
      .map((call) => String(call?.[0] || ''))
      .join('\n')
    expect(combinedErrors).toContain(
      'Failed to locate the extension-develop runtime'
    )
    errorSpy.mockRestore()
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
      if (joined.includes('where corepack')) return 'C:\\corepack\\corepack.cmd'
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
      expect(call?.[0]).toBe('corepack')
    }
    expect(argsStr).toContain('pnpm')
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
      expect(call?.[0]).toBe('npm')
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
  })
})
