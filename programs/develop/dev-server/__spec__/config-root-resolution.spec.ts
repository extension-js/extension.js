import {beforeEach, describe, expect, it, vi} from 'vitest'

const {
  loadCommandConfig,
  loadBrowserConfig,
  loadCustomConfig,
  loadProjectConfigDefaults
} = vi.hoisted(() => ({
  loadCommandConfig: vi.fn(async () => ({})),
  loadProjectConfigDefaults: vi.fn(async () => ({})),
  loadBrowserConfig: vi.fn(async () => ({})),
  loadCustomConfig: vi.fn(async () => (config: any) => config)
}))

const {rspackSpy, devServerConfigCapture} = vi.hoisted(() => ({
  rspackSpy: vi.fn(() => ({})),
  devServerConfigCapture: {current: undefined as any}
}))

vi.mock('@rspack/core', () => ({
  rspack: rspackSpy
}))

vi.mock('@rspack/dev-server', () => ({
  RspackDevServer: class MockRspackDevServer {
    constructor(config: any) {
      devServerConfigCapture.current = config
    }

    start = vi.fn(async () => {})
  }
}))

vi.mock('../frameworks', () => ({
  isUsingJSFramework: vi.fn(() => false)
}))

vi.mock('../../lib/config-loader', () => ({
  loadCommandConfig,
  loadBrowserConfig,
  loadCustomConfig,
  loadConfigResolvedHook: vi.fn(async () => undefined),
  loadProjectConfigDefaults
}))

vi.mock(
  '../../plugin-special-folders/folder-extensions/resolve-config',
  () => ({
    resolveCompanionExtensionsConfig: vi.fn(async () => undefined)
  })
)

vi.mock('../../plugin-special-folders/get-data', () => ({
  getSpecialFoldersDataForProjectRoot: vi.fn(() => ({extensions: undefined})),
  rememberSpecialFoldersConfig: vi.fn()
}))

vi.mock('../../lib/sanitize', () => ({
  sanitize: (value: unknown) => value
}))

vi.mock('../compiler-hooks', () => ({
  setupCompilerLifecycleHooks: vi.fn(),
  setupNoBrowserBannerOnFirstDone: vi.fn()
}))

vi.mock('../cleanup', () => ({
  setupCleanupHandlers: vi.fn()
}))

vi.mock('../../plugin-playwright', () => ({
  createPlaywrightMetadataWriter: vi.fn(() => ({})),
  detectLiveDevSessionOwner: vi.fn(() => null),
  getSessionRunId: vi.fn(() => 'run-test')
}))

vi.mock('../../rspack-config', () => ({
  default: vi.fn(() => ({
    plugins: [],
    devServer: {}
  }))
}))

vi.mock('../port-manager', () => ({
  PortManager: class MockPortManager {
    allocatePorts = vi.fn(async () => ({port: 8080}))
    getCurrentInstance = vi.fn(() => ({instanceId: 'instance-1'}))
    releaseReservedPort = vi.fn(async () => {})
  }
}))

import {rememberSpecialFoldersConfig} from '../../plugin-special-folders/folders-config'
import {devServer} from '../index'

describe('dev-server config root resolution', () => {
  beforeEach(() => {
    loadCommandConfig.mockClear()
    loadBrowserConfig.mockClear()
    loadCustomConfig.mockClear()
    rspackSpy.mockClear()
    devServerConfigCapture.current = undefined
  })

  it('loads extension.config from package root when manifest is in src', async () => {
    await devServer(
      {
        manifestPath: '/proj/src/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      {browser: 'chrome'} as any
    )

    expect(loadCommandConfig).toHaveBeenCalledWith('/proj', 'dev')
    expect(loadBrowserConfig).toHaveBeenCalledWith('/proj', 'chrome')
    expect(loadCustomConfig).toHaveBeenCalledWith('/proj')
  })

  it('keeps manifest writes out of dev-middleware disk persistence', async () => {
    await devServer(
      {
        manifestPath: '/proj/src/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      {browser: 'chrome'} as any
    )

    expect(
      devServerConfigCapture.current.devMiddleware.writeToDisk(
        '/proj/dist/chrome/background.js'
      )
    ).toBe(true)

    expect(
      devServerConfigCapture.current.devMiddleware.writeToDisk(
        '/proj/dist/chrome/manifest.json'
      )
    ).toBe(false)

    expect(
      devServerConfigCapture.current.devMiddleware.writeToDisk('manifest.json')
    ).toBe(false)
  })

  it('watches public/** and HTML sources for non-framework projects', async () => {
    await devServer(
      {
        manifestPath: '/proj/src/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      {browser: 'chrome'} as any
    )

    const watchFiles = devServerConfigCapture.current.watchFiles
    expect(watchFiles).toBeDefined()
    const norm = (p: string) => p.replace(/\\/g, '/')
    const paths = (watchFiles.paths as string[]).map(norm)
    expect(paths.some((p) => p.includes('/public/'))).toBe(true)
    expect(paths.some((p) => p.endsWith('/**/*.html'))).toBe(true)
    const ignored = (watchFiles.options.ignored as string[]).map(norm)
    expect(ignored).toContain('/proj/dist/**/*')
  })

  it('enables hot and liveReload but disables WDS client injection', async () => {
    await devServer(
      {
        manifestPath: '/proj/src/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      {browser: 'firefox'} as any
    )

    expect(devServerConfigCapture.current.hot).toBe(true)
    expect(devServerConfigCapture.current.liveReload).toBe(true)
    expect(devServerConfigCapture.current.client).toBe(false)
  })

  it('names the connectable host instead of admitting every Host header', async () => {
    await devServer(
      {
        manifestPath: '/proj/src/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      {browser: 'chrome'} as any
    )

    expect(devServerConfigCapture.current.allowedHosts).toEqual(['127.0.0.1'])
  })

  it('reflects allow-origin for the extension alone, never a star', async () => {
    await devServer(
      {
        manifestPath: '/proj/src/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      {browser: 'chrome'} as any
    )

    const headers = devServerConfigCapture.current.headers
    expect(typeof headers).toBe('function')

    const headerFor = (origin?: string) =>
      new Map<string, string>(
        headers({headers: origin ? {origin} : {}}).map(
          ({key, value}: {key: string; value: string}) => [
            key.toLowerCase(),
            value
          ]
        )
      )

    expect(headerFor('chrome-extension://abcdefgh')).toEqual(
      new Map([
        ['vary', 'Origin'],
        ['access-control-allow-origin', 'chrome-extension://abcdefgh']
      ])
    )

    expect(headerFor('https://evil.test')).toEqual(
      new Map([['vary', 'Origin']])
    )

    expect(headerFor()).toEqual(new Map([['vary', 'Origin']]))
  })

  it('serves and watches nothing when the public folder is off', async () => {
    rememberSpecialFoldersConfig('/proj', {public: false})

    try {
      await devServer(
        {
          manifestPath: '/proj/src/manifest.json',
          packageJsonPath: '/proj/package.json'
        },
        {browser: 'chrome'} as any
      )
    } finally {
      rememberSpecialFoldersConfig('/proj', undefined)
    }

    const config = devServerConfigCapture.current
    expect(config.static).toBe(false)
    expect(
      (config.watchFiles.paths as string[]).some((entry) =>
        entry.replace(/\\/g, '/').includes('/public/')
      )
    ).toBe(false)
  })
})
