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
  const mockDevelopRoot = async () => {
    const isDevelopPackageJson = (p: string) =>
      p.endsWith(`${path.sep}programs${path.sep}develop${path.sep}package.json`)

    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => isDevelopPackageJson(p),
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
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
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
})
