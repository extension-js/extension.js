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

  it('watches public/** and HTML sources for non-framework projects', async () => {
    // The dev-server's watchFiles broadcast (`static-changed` →
    // `self.location.reload()` in the bundled HMR client) is the only path
    // that delivers public/* asset edits and HTML-entry edits to already-open
    // extension pages once rspack 2.x stopped bumping stats.hash for
    // asset-only rebuilds. Without these watch paths, edits to
    // _locales/*.json, manifest.json, public/*, or src/**/*.html are
    // invisible to the open extension UI until the user manually reloads.
    await devServer(
      {
        manifestPath: '/proj/src/manifest.json',
        packageJsonPath: '/proj/package.json'
      },
      {browser: 'chrome'} as any
    )

    const watchFiles = devServerConfigCapture.current.watchFiles
    expect(watchFiles).toBeDefined()
    const paths = watchFiles.paths as string[]
    expect(paths.some((p) => p.includes('/public/'))).toBe(true)
    expect(paths.some((p) => p.endsWith('/**/*.html'))).toBe(true)
    expect(watchFiles.options.ignored).toContain('/proj/dist/**/*')
  })

  it('enables hot and liveReload but disables WDS client injection', async () => {
    // Content scripts strip the dev-server runtime entirely via
    // StripContentScriptDevServerRuntime, so re-enabling liveReload no longer
    // triggers content-script reload loops. liveReload: true is required so
    // the dev-server's watchFiles change broadcast and the bundled HMR
    // client's reloadApp -> liveReload fallback both fire when an HTML entry
    // is edited (rspack 2.x stopped bumping stats.hash on asset-only
    // rebuilds, breaking the previous accidental hot-update path).
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
})
