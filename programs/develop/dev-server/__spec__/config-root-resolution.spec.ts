import {describe, it, expect, vi, beforeEach} from 'vitest'

const {loadCommandConfig, loadBrowserConfig, loadCustomConfig} = vi.hoisted(
  () => ({
    loadCommandConfig: vi.fn(async () => ({})),
    loadBrowserConfig: vi.fn(async () => ({})),
    loadCustomConfig: vi.fn(async () => (config: any) => config)
  })
)

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
  loadCustomConfig
}))

vi.mock(
  '../../plugin-special-folders/folder-extensions/resolve-config',
  () => ({
    resolveCompanionExtensionsConfig: vi.fn(async () => undefined)
  })
)

vi.mock('../../plugin-special-folders/get-data', () => ({
  getSpecialFoldersDataForProjectRoot: vi.fn(() => ({extensions: undefined}))
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
  createPlaywrightMetadataWriter: vi.fn(() => ({}))
}))

vi.mock('../../rspack-config', () => ({
  default: vi.fn(() => ({
    plugins: [],
    devServer: {}
  }))
}))

vi.mock('../port-manager', () => ({
  PortManager: class MockPortManager {
    allocatePorts = vi.fn(async () => ({port: 8080, webSocketPort: 8081}))
    getCurrentInstance = vi.fn(() => ({instanceId: 'instance-1'}))
  }
}))

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

  it('enables hot but disables liveReload and client for content scripts', async () => {
    await devServer(
      {
        manifestPath: '/proj/src/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      {browser: 'firefox'} as any
    )

    expect(devServerConfigCapture.current.hot).toBe(true)
    expect(devServerConfigCapture.current.liveReload).toBe(false)
    expect(devServerConfigCapture.current.client).toBe(false)
  })
})
