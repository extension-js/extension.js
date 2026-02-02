import {describe, it, expect, vi, beforeEach} from 'vitest'

const ensureProjectReady = vi.fn(async () => {})

vi.mock('../../webpack/webpack-lib/dependency-manager', () => ({
  ensureProjectReady
}))

describe('postinstall auto-install', () => {
  beforeEach(() => {
    ensureProjectReady.mockClear()
    delete process.env.EXTENSION_DISABLE_AUTO_INSTALL
    delete process.env.EXTENSION_POSTINSTALL_MODULE_DIR
    delete process.env.INIT_CWD
    delete process.env.npm_config_command
    delete process.env.npm_config_argv
    delete process.env.npm_config_user_agent
    delete process.env.npm_execpath
    delete process.env.npm_config_cache
    vi.resetModules()
  })

  it('runs auto-install for dependency installs', async () => {
    process.env.INIT_CWD = '/tmp/project'
    process.env.npm_config_command = 'install'
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === '/tmp/project/package.json',
        readFileSync: (p: string) =>
          p === '/tmp/project/package.json'
            ? JSON.stringify({dependencies: {'extension-develop': '1.0.0'}})
            : ''
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

  it('skips auto-install when npm_execpath points to npx', async () => {
    process.env.INIT_CWD = '/tmp/project'
    process.env.npm_execpath = '/usr/local/lib/node_modules/npm/bin/npx-cli.js'
    process.env.npm_config_command = 'exec'
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

  it('skips auto-install when package.json lacks extension deps', async () => {
    process.env.INIT_CWD = '/tmp/project'
    process.env.npm_config_command = 'install'
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === '/tmp/project/package.json',
        readFileSync: (p: string) =>
          p === '/tmp/project/package.json' ? JSON.stringify({}) : ''
      }
    })

    await import('../../postinstall')

    expect(ensureProjectReady).not.toHaveBeenCalled()
  })

  it('skips auto-install when npm_config_command is exec', async () => {
    process.env.INIT_CWD = '/tmp/project'
    process.env.npm_config_command = 'exec'
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

  it('skips auto-install when command is not an explicit install', async () => {
    process.env.INIT_CWD = '/tmp/project'
    process.env.npm_config_command = 'run'
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

  it('skips auto-install when running from npm _npx cache', async () => {
    const cwdSpy = vi
      .spyOn(process, 'cwd')
      .mockReturnValue('/Users/name/.npm/_npx/12345')
    process.env.INIT_CWD = '/tmp/project'
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === '/tmp/project/package.json'
      }
    })

    await import('../../postinstall')

    expect(ensureProjectReady).not.toHaveBeenCalled()
    cwdSpy.mockRestore()
  })

  it('skips auto-install when moduleDir is under npm _npx cache', async () => {
    process.env.INIT_CWD = '/tmp/project'
    process.env.npm_config_command = 'install'
    process.env.npm_config_cache = '/Users/name/.npm'
    process.env.EXTENSION_POSTINSTALL_MODULE_DIR =
      '/Users/name/.npm/_npx/12345/node_modules/extension-develop'
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => p === '/tmp/project/package.json',
        readFileSync: (p: string) =>
          p === '/tmp/project/package.json'
            ? JSON.stringify({devDependencies: {extension: '^1.0.0'}})
            : ''
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
