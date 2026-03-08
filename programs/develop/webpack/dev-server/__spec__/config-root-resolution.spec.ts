import {describe, it, expect, vi, beforeEach} from 'vitest'

const {loadCommandConfig, loadBrowserConfig, loadCustomWebpackConfig} =
  vi.hoisted(() => ({
    loadCommandConfig: vi.fn(async () => ({})),
    loadBrowserConfig: vi.fn(async () => ({})),
    loadCustomWebpackConfig: vi.fn(async () => (config: any) => config)
  }))

vi.mock('@rspack/core', () => ({
  rspack: vi.fn(() => ({}))
}))

vi.mock('@rspack/dev-server', () => ({
  RspackDevServer: class MockRspackDevServer {
    start = vi.fn(async () => {})
  }
}))

vi.mock('../frameworks', () => ({
  isUsingJSFramework: vi.fn(() => false)
}))

vi.mock('../../webpack-lib/config-loader', () => ({
  loadCommandConfig,
  loadBrowserConfig,
  loadCustomWebpackConfig
}))

vi.mock(
  '../../feature-special-folders/folder-extensions/resolve-config',
  () => ({
    resolveCompanionExtensionsConfig: vi.fn(async () => undefined)
  })
)

vi.mock('../../feature-special-folders/get-data', () => ({
  getSpecialFoldersDataForProjectRoot: vi.fn(() => ({extensions: undefined}))
}))

vi.mock('../../webpack-lib/sanitize', () => ({
  sanitize: (value: unknown) => value
}))

vi.mock('../compiler-hooks', () => ({
  setupCompilerHooks: vi.fn()
}))

vi.mock('../cleanup', () => ({
  setupCleanupHandlers: vi.fn()
}))

vi.mock('../../plugin-playwright', () => ({
  createPlaywrightMetadataWriter: vi.fn(() => ({}))
}))

vi.mock('../../webpack-config', () => ({
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
    loadCustomWebpackConfig.mockClear()
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
    expect(loadCustomWebpackConfig).toHaveBeenCalledWith('/proj')
  })
})
