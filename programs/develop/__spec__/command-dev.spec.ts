import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

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
  isUsingTypeScript: vi.fn(() => true),
  ensureTypeScriptConfig: vi.fn()
}))

vi.mock('../lib/config-loader', () => ({
  loadBrowserConfig: vi.fn(async () => ({})),
  loadCommandConfig: vi.fn(async () => ({}))
}))

import {extensionDev} from '../command-dev'
import * as devServerMod from '../dev-server'
import * as configLoaderMod from '../lib/config-loader'
import * as ensureArtifactsMod from '../lib/ensure-develop-artifacts'
import * as genTypesMod from '../lib/generate-extension-types'

describe('webpack/command-dev', () => {
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

  describe('option precedence (CLI > commands.dev > browser > defaults)', () => {
    function pluginBrowserOptions() {
      const devServerCall = (devServerMod as any).devServer.mock.calls[0]
      const plugin = devServerCall?.[1]?.browsersPlugin
      return (plugin as any).options?.browserOptions
    }

    function devServerOptions() {
      return (devServerMod as any).devServer.mock.calls[0]?.[1]
    }

    beforeEach(() => {
      ;(fs.existsSync as any).mockReturnValue(false)
      ;(fs.readdirSync as any).mockReturnValue([])
    })

    it('applies stock defaults when neither config nor CLI sets a value', async () => {
      await extensionDev('/proj', {
        browser: 'chrome',
        port: 0,
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions()).toMatchObject({
        noOpen: false,
        logFormat: 'pretty',
        logTimestamps: true,
        logColor: true,
        logLevel: 'off'
      })
      // Bundler-facing options ride the same merge into devServer.
      expect(devServerOptions().polyfill).toBe(true)
    })

    it('lets commands.dev beat browser config and stock defaults (config-only)', async () => {
      ;(configLoaderMod as any).loadBrowserConfig.mockResolvedValueOnce({
        browser: 'chrome',
        startingUrl: 'https://from-browser.example',
        noOpen: false
      })
      ;(configLoaderMod as any).loadCommandConfig.mockResolvedValueOnce({
        startingUrl: 'https://from-commands-dev.example',
        noOpen: true,
        logFormat: 'json',
        polyfill: false
      })

      await extensionDev('/proj', {
        browser: 'chrome',
        port: 0,
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions()).toMatchObject({
        startingUrl: 'https://from-commands-dev.example',
        noOpen: true,
        logFormat: 'json'
      })
      expect(devServerOptions().polyfill).toBe(false)
    })

    it('lets explicit CLI values beat commands.dev in both directions (both)', async () => {
      ;(configLoaderMod as any).loadCommandConfig.mockResolvedValueOnce({
        startingUrl: 'https://from-commands-dev.example',
        noOpen: true,
        logFormat: 'json',
        polyfill: false,
        logColor: false
      })

      await extensionDev('/proj', {
        browser: 'chrome',
        port: 0,
        startingUrl: 'https://from-cli.example',
        noOpen: false,
        logFormat: 'pretty',
        polyfill: true,
        logColor: true,
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions()).toMatchObject({
        startingUrl: 'https://from-cli.example',
        noOpen: false,
        logFormat: 'pretty',
        logColor: true
      })
      expect(devServerOptions().polyfill).toBe(true)
    })

    it('applies flag-only values over stock defaults (flag-only)', async () => {
      await extensionDev('/proj', {
        browser: 'chrome',
        port: 0,
        polyfill: false,
        logFormat: 'ndjson',
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions()).toMatchObject({
        logFormat: 'ndjson',
        logTimestamps: true
      })
      expect(devServerOptions().polyfill).toBe(false)
    })

    it('concatenates browserFlags and deep-merges preferences across layers', async () => {
      ;(configLoaderMod as any).loadBrowserConfig.mockResolvedValueOnce({
        browser: 'chrome',
        browserFlags: ['--from-browser'],
        excludeBrowserFlags: ['--exclude-browser'],
        preferences: {a: 1, nested: {x: 1}}
      })
      ;(configLoaderMod as any).loadCommandConfig.mockResolvedValueOnce({
        browserFlags: ['--from-command'],
        excludeBrowserFlags: ['--exclude-command'],
        preferences: {b: 2, nested: {y: 2}}
      })

      await extensionDev('/proj', {
        browser: 'chrome',
        port: 0,
        browserFlags: ['--from-cli'],
        preferences: {a: 99, nested: {x: 3}},
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions()).toMatchObject({
        browserFlags: ['--from-browser', '--from-command', '--from-cli'],
        excludeBrowserFlags: ['--exclude-browser', '--exclude-command'],
        preferences: {a: 99, b: 2, nested: {x: 3, y: 2}}
      })
    })
  })

  it('prints contract errors once, clean, without a stack trace (bug 28)', async () => {
    const localErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    // Nightly jobs export author mode, pin it off for this assertion.
    vi.stubEnv('EXTENSION_AUTHOR_MODE', 'false')

    ;(devServerMod as any).devServer.mockImplementationOnce(async () => {
      throw new Error(
        '[Extension.js] Missing tsconfig.json next to package.json. Create one to use TypeScript.'
      )
    })

    await expect(
      extensionDev('/proj', {browser: 'chrome'} as any)
    ).rejects.toThrow(/Missing tsconfig\.json/)

    expect(localErrorSpy).toHaveBeenCalledTimes(1)
    const printed = localErrorSpy.mock.calls[0][0]
    expect(typeof printed).toBe('string')
    expect(printed).toMatch(/Missing tsconfig\.json/)
    expect(printed).not.toMatch(/\n\s+at /)
  })

  it('rejects on failure so the CLI wrapper can frame or exit it', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      // @ts-expect-error
      .mockImplementation(() => {
        throw new Error('exit 1')
      })

    ;(devServerMod as any).devServer.mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    // Library contract: no exitOnError means reject, never process.exit; the
    // CLI wrapper opts into exiting on its pretty path.
    await expect(
      extensionDev('/proj', {browser: 'firefox'} as any)
    ).rejects.toThrow('boom')
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })
})
