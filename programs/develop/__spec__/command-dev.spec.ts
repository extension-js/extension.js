import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'

vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn()
  }
})

vi.mock('../lib/project', () => ({
  getProjectStructure: vi.fn(async () => ({
    manifestPath: '/proj/manifest.json',
    packageJsonPath: '/proj/package.json'
  }))
}))

vi.mock('../dev-server', () => {
  const devServer = vi.fn(async () => {})
  return {devServer}
})

vi.mock('../lib/generate-extension-types', () => {
  const generateExtensionTypes = vi.fn(async () => {})
  return {generateExtensionTypes}
})

vi.mock('../lib/validate-user-dependencies', () => ({
  assertNoManagedDependencyConflicts: vi.fn()
}))

vi.mock('../lib/ensure-develop-artifacts', () => ({
  ensureDevelopArtifacts: vi.fn(async () => {}),
  ensureUserProjectDependencies: vi.fn(async () => {})
}))

vi.mock('../plugin-js-frameworks/js-tools/typescript', () => ({
  isUsingTypeScript: vi.fn(() => true)
}))

vi.mock('../lib/config-loader', () => ({
  loadBrowserConfig: vi.fn(async () => ({})),
  loadCommandConfig: vi.fn(async () => ({}))
}))

import {extensionDev} from '../command-dev'
import * as devServerMod from '../dev-server'
import * as genTypesMod from '../lib/generate-extension-types'
import * as ensureArtifactsMod from '../lib/ensure-develop-artifacts'
import * as configLoaderMod from '../lib/config-loader'

describe('webpack/command-dev', () => {
  // fs is mocked module - configure per-test behaviors via mockImplementation
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.resetModules()
    ;(devServerMod as any).devServer?.mockClear?.()
    ;(genTypesMod as any).generateExtensionTypes?.mockClear?.()
    ;(ensureArtifactsMod as any).ensureDevelopArtifacts?.mockClear?.()
    ;(ensureArtifactsMod as any).ensureUserProjectDependencies?.mockClear?.()
    ;(configLoaderMod as any).loadBrowserConfig?.mockReset?.()
    ;(configLoaderMod as any).loadCommandConfig?.mockReset?.()
    ;(configLoaderMod as any).loadBrowserConfig?.mockResolvedValue?.({})
    ;(configLoaderMod as any).loadCommandConfig?.mockResolvedValue?.({})
    ;(fs.existsSync as any)?.mockReset?.()
    ;(fs.readdirSync as any)?.mockReset?.()
    logSpy.mockClear()
    errorSpy.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates types for TS projects, installs dependencies if needed, and starts dev server with defaults', async () => {
    // Simulate missing node_modules
    const nodeModules = path.join('/proj', 'node_modules')
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) =>
      String(p) === nodeModules ? false : false
    )
    ;(fs.readdirSync as any).mockReturnValue([])

    await extensionDev('/proj', {browser: undefined, port: 0} as any)

    expect(genTypesMod.generateExtensionTypes).toHaveBeenCalledWith(
      '/proj',
      '/proj'
    )
    expect(ensureArtifactsMod.ensureDevelopArtifacts).toHaveBeenCalled()
    expect(devServerMod.devServer).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({mode: 'development', browser: 'chrome'})
    )
  })

  it('skips user dependency install when install option is false', async () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    ;(fs.readdirSync as any).mockReturnValue([])

    await extensionDev('/proj', {
      browser: undefined,
      port: 0,
      install: false
    } as any)

    expect(
      ensureArtifactsMod.ensureUserProjectDependencies
    ).not.toHaveBeenCalled()
  })

  it('forwards extension.config.js browser.profile to the BrowsersPlugin launcher', async () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    ;(fs.readdirSync as any).mockReturnValue([])
    ;(configLoaderMod as any).loadBrowserConfig.mockResolvedValueOnce({
      browser: 'chrome',
      profile: '/explicit/profile',
      browserFlags: ['--my-flag'],
      persistProfile: true
    })

    const launcher = vi.fn(async () => ({
      reload: vi.fn(async () => {}),
      enableUnifiedLogging: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }))

    await extensionDev('/proj', {
      browser: 'chrome',
      port: 0,
      launcher
    } as any)

    const devServerCall = (devServerMod as any).devServer.mock.calls[0]
    const forwardedOptions = devServerCall?.[1]
    const plugin = forwardedOptions?.browsersPlugin
    expect(plugin).toBeDefined()
    const browserOptions = (plugin as any).options?.browserOptions
    expect(browserOptions).toMatchObject({
      profile: '/explicit/profile',
      browserFlags: ['--my-flag'],
      persistProfile: true
    })
  })

  it('lets CLI devOptions.profile override extension.config.js profile', async () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    ;(fs.readdirSync as any).mockReturnValue([])
    ;(configLoaderMod as any).loadBrowserConfig.mockResolvedValueOnce({
      browser: 'chrome',
      profile: '/from/config'
    })

    const launcher = vi.fn()

    await extensionDev('/proj', {
      browser: 'chrome',
      port: 0,
      profile: '/from/cli',
      launcher
    } as any)

    const devServerCall = (devServerMod as any).devServer.mock.calls[0]
    const plugin = devServerCall?.[1]?.browsersPlugin
    const browserOptions = (plugin as any).options?.browserOptions
    expect(browserOptions.profile).toBe('/from/cli')
  })

  it('exits process(1) on unexpected error', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      // @ts-ignore
      .mockImplementation(() => {
        throw new Error('exit 1')
      })

    ;(devServerMod as any).devServer.mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    await expect(
      extensionDev('/proj', {browser: 'firefox'} as any)
    ).rejects.toThrow('exit 1')
    exitSpy.mockRestore()
  })
})
