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

// Mocks for modules the SUT uses
vi.mock('../webpack-lib/project', () => ({
  getProjectStructure: vi.fn(async () => ({
    manifestPath: '/proj/manifest.json',
    packageJsonPath: '/proj/package.json'
  }))
}))

// Provide a minimal plugin shape to exercise filtering
const SOME_OTHER_PLUGIN = {constructor: {name: 'OtherPlugin'}}

vi.mock('../webpack-config', async () => {
  // Ensure this mock can reference the plugin name without hoist issues
  const pluginBrowsersLike = {constructor: {name: 'plugin-browsers'}}
  return {
    default: vi.fn(() => ({
      plugins: [pluginBrowsersLike, SOME_OTHER_PLUGIN],
      output: {}
    }))
  }
})

vi.mock('webpack-merge', () => ({merge: (cfg: any) => cfg}))

// user config returns the config it receives so we can assert filtered plugins were passed in
vi.mock('../webpack-lib/config-loader', () => {
  const userConfigSpy = vi.fn((cfg: any) => cfg)
  return {
    loadCustomWebpackConfig: vi.fn(async () => userConfigSpy),
    loadCommandConfig: vi.fn(async () => ({some: 'cmd'})),
    userConfigSpy
  }
})

vi.mock('../webpack-lib/install-dependencies', () => {
  const installDependencies = vi.fn(async () => {})
  return {installDependencies}
})

vi.mock('../webpack-lib/validate-user-dependencies', () => ({
  assertNoManagedDependencyConflicts: vi.fn()
}))

// Make rspack compiler controllable
function makeCompiler(statsImpl: any, failErr?: any) {
  return {
    run: (cb: any) => cb(failErr, statsImpl),
    close: (cb: any) => cb?.()
  }
}

vi.mock('@rspack/core', () => {
  const rspack = vi.fn()
  return {rspack}
})

// Scrub brand is used in error printing
vi.mock('../webpack-lib/branding', () => ({
  scrubBrand: (s: string) => s.replace(/Rspack/gi, 'Extension.js')
}))

// Silence logs
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

import {extensionBuild} from '../command-build'
import * as installDepsMod from '../webpack-lib/install-dependencies'
import * as configLoaderMod from '../webpack-lib/config-loader'
import * as rspackMod from '@rspack/core'

describe('webpack/command-build', () => {
  // fs is mocked; configure per-test behavior below

  beforeEach(() => {
    vi.resetModules()
    ;(configLoaderMod as any).userConfigSpy?.mockClear?.()
    ;(installDepsMod.installDependencies as any)?.mockClear?.()
    ;(rspackMod as any).rspack?.mockClear?.()
    logSpy.mockClear()
    errorSpy.mockClear()
    process.env.VITEST = undefined
    process.env.EXTENSION_VERBOSE = undefined
    ;(fs.existsSync as any)?.mockReset?.()
    ;(fs.readdirSync as any)?.mockReset?.()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds successfully, filters browser plugins, merges user config, and returns summary', async () => {
    // Simulate presence of node_modules (no install)
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])

    const stats = {
      hasErrors: () => false,
      toJson: () => ({
        assets: [
          {name: 'a.js', size: 10},
          {name: 'b.css', size: 30}
        ],
        warnings: [],
        errors: [],
        time: 500
      })
    }
    ;(rspackMod as any).rspack.mockReturnValue(makeCompiler(stats))

    const summary = await extensionBuild('/proj', {
      browser: 'chrome',
      silent: true
    })
    expect(summary).toEqual({
      browser: 'chrome',
      total_assets: 2,
      total_bytes: 40,
      largest_asset_bytes: 30,
      warnings_count: 0,
      errors_count: 0
    })

    // user config was given only non-browser plugins
    expect((configLoaderMod as any).userConfigSpy).toHaveBeenCalledTimes(1)
    const passedConfig = (configLoaderMod as any).userConfigSpy.mock.calls[0][0]
    const passedPlugins = passedConfig.plugins || []
    expect(passedPlugins).toEqual([SOME_OTHER_PLUGIN])

    // rspack called with merged config
    expect((rspackMod as any).rspack).toHaveBeenCalledTimes(1)
  })

  it('installs dependencies when node_modules is missing or empty', async () => {
    const nodeModules = path.join('/proj', 'node_modules')
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      // path exists but is empty dir
      return String(p) === nodeModules || false
    })
    ;(fs.readdirSync as any).mockReturnValue([])

    const stats = {hasErrors: () => false, toJson: () => ({assets: []})}
    ;(rspackMod as any).rspack.mockReturnValue(makeCompiler(stats))

    await extensionBuild('/proj', {browser: 'chrome', silent: true})
    expect(installDepsMod.installDependencies).toHaveBeenCalled()
  })

  it('does not install dependencies in vitest mode and rejects instead of exiting when exitOnError=false', async () => {
    process.env.VITEST = 'true'
    ;(fs.existsSync as any).mockReturnValue(false)
    ;(fs.readdirSync as any).mockReturnValue([])

    const stats = {
      hasErrors: () => true,
      toString: () => 'Rspack: ModuleBuildError:\n\n\n'
    }
    ;(rspackMod as any).rspack.mockReturnValue(makeCompiler(stats))

    await expect(
      extensionBuild('/proj', {
        browser: 'chrome',
        silent: true,
        exitOnError: false
      })
    ).rejects.toThrow(/Build failed with errors/)

    expect(installDepsMod.installDependencies).not.toHaveBeenCalled()
  })
})
