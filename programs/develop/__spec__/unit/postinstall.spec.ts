import {describe, it, expect, vi, beforeEach} from 'vitest'

const ensureProjectReady = vi.fn(async () => {})

vi.mock('../../webpack/webpack-lib/dependency-manager', () => ({
  ensureProjectReady
}))

describe('postinstall auto-install', () => {
  beforeEach(() => {
    ensureProjectReady.mockClear()
    delete process.env.EXTENSION_DISABLE_AUTO_INSTALL
    delete process.env.INIT_CWD
    vi.resetModules()
  })

  it('runs auto-install for dependency installs', async () => {
    process.env.INIT_CWD = '/tmp/project'
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === '/tmp/project/package.json'
      }
    })

    await import('../../postinstall')

    expect(ensureProjectReady).toHaveBeenCalledWith(
      {
        manifestPath: '/tmp/project/manifest.json',
        packageJsonPath: '/tmp/project/package.json'
      },
      'development',
      expect.objectContaining({
        installUserDeps: true,
        installBuildDeps: true,
        installOptionalDeps: true
      })
    )
  })

  it('skips auto-install when invoked via npm exec', async () => {
    process.env.INIT_CWD = '/tmp/project'
    process.env.npm_config_argv = JSON.stringify({
      original: ['exec', 'extension@next', 'create', 'a5'],
      cooked: ['exec', 'extension@next', 'create', 'a5']
    })
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === '/tmp/project/package.json'
      }
    })

    await import('../../postinstall')

    expect(ensureProjectReady).not.toHaveBeenCalled()
  })

  it('skips auto-install when invoked via pnpm dlx', async () => {
    process.env.INIT_CWD = '/tmp/project'
    process.env.npm_config_argv = JSON.stringify({
      original: ['dlx', 'extension@next', 'create', 'a5'],
      cooked: ['dlx', 'extension@next', 'create', 'a5']
    })
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === '/tmp/project/package.json'
      }
    })

    await import('../../postinstall')

    expect(ensureProjectReady).not.toHaveBeenCalled()
  })

  it('skips auto-install when invoked via bunx', async () => {
    process.env.INIT_CWD = '/tmp/project'
    process.env.npm_config_argv = JSON.stringify({
      original: ['bunx', 'extension@next', 'create', 'a5'],
      cooked: ['bunx', 'extension@next', 'create', 'a5']
    })
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === '/tmp/project/package.json'
      }
    })

    await import('../../postinstall')

    expect(ensureProjectReady).not.toHaveBeenCalled()
  })

  it('skips auto-install when disabled', async () => {
    process.env.EXTENSION_DISABLE_AUTO_INSTALL = 'true'
    process.env.INIT_CWD = '/tmp/project'

    await import('../../postinstall')

    expect(ensureProjectReady).not.toHaveBeenCalled()
  })
})
