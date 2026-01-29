import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'

const originalResolve = (require as any).resolve

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(() => ({status: 0}))
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

    const {execFileSync} = (await import('child_process')) as any
    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(execFileSync).toHaveBeenCalled()
    const call = execFileSync.mock.calls[0]
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
    const {execFileSync} = (await import('child_process')) as any
    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(execFileSync).not.toHaveBeenCalled()
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

    const {execFileSync} = (await import('child_process')) as any
    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe('pnpm')
    expect(call?.[1]).toContain('add')
    expect(call?.[1]).toContain('--dir')
    expect(call?.[1]).toContain('--save-optional')
    expect(call?.[1]).not.toContain('--cwd')
  })

  it('prefers env package manager even when command check fails', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'pnpm'

    const {execFileSync, spawnSync} = (await import('child_process')) as any
    spawnSync.mockReturnValueOnce({status: 1})

    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe('pnpm')
  })

  it('falls back to npm cli when env manager is missing', async () => {
    await mockDevelopRoot(['/tmp/npm-cli.js'])
    process.env.npm_config_user_agent = 'pnpm'
    process.env.EXTENSION_JS_PM_EXEC_PATH = '/tmp/npm-cli.js'

    const {execFileSync} = (await import('child_process')) as any
    execFileSync.mockImplementationOnce(() => {
      const err: NodeJS.ErrnoException = new Error('spawn pnpm ENOENT')
      err.code = 'ENOENT'
      throw err
    })

    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    expect(execFileSync).toHaveBeenCalledTimes(2)
    const fallbackCall = execFileSync.mock.calls[1]
    expect(fallbackCall?.[0]).toBe(process.execPath)
    expect(fallbackCall?.[1]?.[0]).toBe('/tmp/npm-cli.js')
  })

  it('uses EXTENSION_JS_PACKAGE_MANAGER override when provided', async () => {
    await mockDevelopRoot()
    process.env.EXTENSION_JS_PACKAGE_MANAGER = 'yarn'

    const {execFileSync} = (await import('child_process')) as any
    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe('yarn')
  })

  it('wraps EXTENSION_JS_PM_EXEC_PATH when no manager is in PATH', async () => {
    await mockDevelopRoot()
    process.env.EXTENSION_JS_PM_EXEC_PATH = '/tmp/npm-cli.js'

    const {execFileSync, spawnSync} = (await import('child_process')) as any
    spawnSync.mockReturnValue({status: 1})

    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe(process.execPath)
    expect(call?.[1]?.[0]).toBe('/tmp/npm-cli.js')
  })

  it('wraps npm_execpath when no manager is in PATH', async () => {
    await mockDevelopRoot()
    process.env.npm_execpath = '/tmp/npm-cli.js'

    const {execFileSync, spawnSync} = (await import('child_process')) as any
    spawnSync.mockReturnValue({status: 1})

    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe(process.execPath)
    expect(call?.[1]?.[0]).toBe('/tmp/npm-cli.js')
  })

  it('uses corepack fallback when no manager is available', async () => {
    await mockDevelopRoot()

    const {execFileSync, spawnSync} = (await import('child_process')) as any
    spawnSync.mockImplementation((cmd: string) =>
      cmd === 'corepack' ? {status: 0} : {status: 1}
    )

    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe('corepack')
    expect(call?.[1]?.[0]).toBe('pnpm')
  })

  it('falls back to npm when nothing is detected', async () => {
    await mockDevelopRoot()

    const {execFileSync, spawnSync} = (await import('child_process')) as any
    spawnSync.mockReturnValue({status: 1})

    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe('npm')
  })

  it('uses npm install with --prefix and --save-optional', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'npm'

    const {execFileSync} = (await import('child_process')) as any
    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe('npm')
    expect(call?.[1]).toContain('install')
    expect(call?.[1]).toContain('--prefix')
    expect(call?.[1]).toContain('--save-optional')
  })

  it('uses yarn add with --cwd and --optional', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'yarn'

    const {execFileSync} = (await import('child_process')) as any
    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe('yarn')
    expect(call?.[1]).toContain('add')
    expect(call?.[1]).toContain('--cwd')
    expect(call?.[1]).toContain('--optional')
  })

  it('uses bun add with --cwd and --optional', async () => {
    await mockDevelopRoot()
    process.env.npm_config_user_agent = 'bun'

    const {execFileSync} = (await import('child_process')) as any
    const {installOptionalDependencies} =
      await import('../../css-lib/integrations')

    await installOptionalDependencies('PostCSS', ['postcss'])

    const call = execFileSync.mock.calls[0]
    expect(call?.[0]).toBe('bun')
    expect(call?.[1]).toContain('add')
    expect(call?.[1]).toContain('--cwd')
    expect(call?.[1]).toContain('--optional')
  })
})
