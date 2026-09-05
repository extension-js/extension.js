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
    manifestPath: '/proj/src/manifest.json',
    packageJsonPath: '/proj/package.json'
  }))
}))

const SOME_OTHER_PLUGIN = {constructor: {name: 'OtherPlugin'}}

vi.mock('../rspack-config', async () => {
  const pluginBrowsersLike = {constructor: {name: 'plugin-browsers'}}
  return {
    default: vi.fn(() => ({
      plugins: [pluginBrowsersLike, SOME_OTHER_PLUGIN],
      output: {}
    }))
  }
})

vi.mock('webpack-merge', () => ({merge: (cfg: any) => cfg}))

vi.mock('../lib/config-loader', () => {
  const userConfigSpy = vi.fn((cfg: any) => cfg)
  return {
    loadCustomConfig: vi.fn(async () => userConfigSpy),
    loadBrowserConfig: vi.fn(async () => ({})),
    loadProjectConfigDefaults: vi.fn(async () => ({})),
    loadCommandConfig: vi.fn(async () => ({
      some: 'cmd',
      transpilePackages: ['@workspace/ui']
    })),
    userConfigSpy
  }
})

vi.mock('../lib/ensure-develop-artifacts', () => ({
  ensureDevelopArtifacts: vi.fn(async () => {}),
  ensureUserProjectDependencies: vi.fn(async () => {})
}))

vi.mock('../lib/generate-extension-types', () => ({
  generateExtensionTypes: vi.fn(async () => {})
}))

vi.mock('../plugin-js-frameworks/js-tools/typescript', () => ({
  isUsingTypeScript: vi.fn(() => false),
  ensureTypeScriptConfig: vi.fn()
}))

vi.mock('../lib/validate-user-dependencies', () => ({
  assertNoManagedDependencyConflicts: vi.fn()
}))

vi.mock('../plugin-special-folders/folder-extensions/resolve-config', () => ({
  resolveCompanionExtensionsConfig: vi.fn(async () => ({paths: ['/comp/a']}))
}))
vi.mock('../plugin-special-folders/get-data', () => ({
  getSpecialFoldersDataForProjectRoot: vi.fn(() => ({extensions: undefined}))
}))

const rspackMock = vi.hoisted(() => vi.fn())

vi.mock('@rspack/core', () => ({
  rspack: rspackMock
}))

function makeCompiler(statsImpl: any, failErr?: any) {
  return {
    run: (cb: any) => cb(failErr, statsImpl),
    close: (cb: any) => cb?.()
  }
}

vi.mock('../lib/branding', () => ({
  scrubBrand: (s: string) => s.replace(/Rspack/gi, 'Extension.js')
}))

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

import {extensionBuild} from '../command-build'
import * as configLoaderMod from '../lib/config-loader'
import * as ensureArtifactsMod from '../lib/ensure-develop-artifacts'
import * as genTypesMod from '../lib/generate-extension-types'
import * as messages from '../lib/messages'
import {recordZipArtifact} from '../plugin-compilation/zip-artifacts'
import * as tsToolsMod from '../plugin-js-frameworks/js-tools/typescript'
import * as resolveConfigMod from '../plugin-special-folders/folder-extensions/resolve-config'
import webpackConfig from '../rspack-config'

describe('webpack/command-build', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(configLoaderMod as any).userConfigSpy?.mockClear?.()
    ;(ensureArtifactsMod.ensureDevelopArtifacts as any)?.mockClear?.()
    ;(ensureArtifactsMod.ensureUserProjectDependencies as any)?.mockClear?.()
    ;(resolveConfigMod as any).resolveCompanionExtensionsConfig?.mockClear?.()
    ;(webpackConfig as any)?.mockClear?.()
    rspackMock.mockClear()
    logSpy.mockClear()
    errorSpy.mockClear()
    process.env.VITEST = undefined
    process.env.EXTENSION_VERBOSE = undefined
    ;(fs.existsSync as any)?.mockReset?.()
    ;(fs.readdirSync as any)?.mockReset?.()
    ;(genTypesMod as any).generateExtensionTypes?.mockClear?.()
    ;(tsToolsMod as any).isUsingTypeScript?.mockReset?.()
    ;(tsToolsMod as any).ensureTypeScriptConfig?.mockReset?.()
    ;(tsToolsMod as any).isUsingTypeScript?.mockReturnValue?.(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds successfully, filters browser plugins, merges user config, and returns summary', async () => {
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
    rspackMock.mockReturnValue(makeCompiler(stats))

    const summary = await extensionBuild('/proj', {
      browser: 'chrome',
      silent: true
    })
    expect(summary).toEqual({
      browser: 'chrome',
      output_path: path.join('/proj', 'dist', 'chrome'),
      total_assets: 2,
      total_bytes: 40,
      largest_asset_bytes: 30,
      warnings_count: 0,
      errors_count: 0
    })

    expect((configLoaderMod as any).userConfigSpy).toHaveBeenCalledTimes(1)
    const passedConfig = (configLoaderMod as any).userConfigSpy.mock.calls[0][0]
    const passedPlugins = passedConfig.plugins || []
    expect(passedPlugins).toEqual([SOME_OTHER_PLUGIN])

    expect(rspackMock).toHaveBeenCalledTimes(1)
    expect(configLoaderMod.loadCommandConfig).toHaveBeenCalledWith(
      '/proj',
      'build'
    )
    expect(configLoaderMod.loadCustomConfig).toHaveBeenCalledWith('/proj')
  })

  it('closes a clean build with the built-for-production line', async () => {
    const localLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])

    const stats = {
      hasErrors: () => false,
      toJson: () => ({
        assets: [{name: 'a.js', size: 10}],
        warnings: [],
        errors: []
      })
    }
    rspackMock.mockReturnValue(makeCompiler(stats))

    await extensionBuild('/proj', {
      browser: 'chrome',
      silent: true
    })

    const printed = localLogSpy.mock.calls.map((call) => String(call[0] || ''))
    expect(
      printed.some((line) => line.includes('built for production in'))
    ).toBe(true)
    expect(printed.some((line) => line.includes('Build succeeded'))).toBe(false)
    expect(printed.some((line) => line.includes('ready for deployment'))).toBe(
      false
    )
  })

  it('prints one packaged receipt per zip artifact after the closer', async () => {
    const localLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])

    const compilation = {}
    recordZipArtifact(compilation, {
      kind: 'dist',
      path: path.join('/proj', 'dist', 'chrome', 'probe.zip'),
      size: 2048
    })
    const stats = {
      hasErrors: () => false,
      toJson: () => ({assets: [{name: 'a.js', size: 10}], warnings: []}),
      compilation
    }
    rspackMock.mockReturnValue(makeCompiler(stats))

    await extensionBuild('/proj', {browser: 'chrome', silent: true})

    const printed = localLogSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(printed).toContain('Packaged')
    expect(printed).toContain('probe.zip')
    expect(printed).toContain('(2.0 KB)')
    const closerAt = printed.indexOf('built for production in')
    const receiptAt = printed.indexOf('Packaged')
    expect(closerAt).toBeGreaterThanOrEqual(0)
    expect(receiptAt).toBeGreaterThan(closerAt)
  })

  it('ends a failed build with one error-count closer', async () => {
    process.env.VITEST = 'true'
    const localErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    ;(fs.existsSync as any).mockReturnValue(false)
    ;(fs.readdirSync as any).mockReturnValue([])

    const stats = {
      hasErrors: () => true,
      toString: () => 'ERROR in ./missing-entry.js',
      toJson: () => ({errors: [{message: 'a'}, {message: 'b'}]})
    }
    rspackMock.mockReturnValue(makeCompiler(stats))

    await expect(
      extensionBuild('/proj', {
        browser: 'chrome',
        silent: true,
        exitOnError: false
      })
    ).rejects.toThrow(/Build failed with errors/)

    const printed = localErrorSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(printed).toContain('Build failed with 2 errors.')
    expect(printed.match(/Build failed with \d+ error/g)?.length).toBe(1)
  })

  it('prints warning details and still closes on the success channel', async () => {
    const localLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])

    const stats = {
      hasErrors: () => false,
      toJson: () => ({
        assets: [{name: 'background/service_worker.js', size: 1000}],
        warnings: [
          {
            message:
              'asset size limit: The following asset(s) exceed the recommended size limit (244.141 KiB). This can impact web performance.',
            details: `Assets:
  03bc89f8e5771202.wasm (20.596 MiB)
  background/service_worker.js (1.560 MiB)
  sidebar/index.js (1.116 MiB)`,
            pluginName: 'rspack/performance-hints',
            file: 'background/service_worker.js'
          },
          {
            message:
              'entrypoint size limit: The following entrypoint(s) combined asset size exceeds the recommended limit (244.141 KiB). This can impact web performance.',
            details: `Entrypoints:
  background/service_worker (1.560 MiB)
    background/service_worker.js
  sidebar/index (1.250 MiB)
    sidebar/index.js
    sidebar/index.css`,
            pluginName: 'rspack/performance-hints'
          }
        ],
        errors: []
      })
    }
    rspackMock.mockReturnValue(makeCompiler(stats))

    const summary = await extensionBuild('/proj', {
      browser: 'chrome',
      silent: true
    })
    expect(summary.warnings_count).toBe(2)

    const printed = localLogSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(printed).toContain('Performance: asset size limit exceeded')
    expect(printed).toContain('Threshold:')
    expect(printed).toContain('Source:')
    expect(printed).toContain('Hint:')
    expect(printed).toContain('Performance: entrypoint size limit exceeded')
    expect(printed).not.toContain('Assets over limit')
    expect(printed).not.toContain('Build succeeded')
    const warningsAt = printed.indexOf('Performance: asset size limit exceeded')
    const closerAt = printed.indexOf('built for production in')
    expect(closerAt).toBeGreaterThan(warningsAt)
  })

  it('formats build output with the original asset tree', () => {
    const stats = {
      hasErrors: () => false,
      compilation: {
        outputOptions: {
          path: '/proj/dist'
        }
      },
      toJson: () => ({
        assets: [
          {name: '03bc89f8e5771202.wasm', size: 21596463},
          {name: 'background/service_worker.js', size: 1635779},
          {name: 'sidebar/index.js', size: 1170411},
          {name: 'sidebar/index.css', size: 140073},
          {name: 'content_scripts/content-1.js', size: 954204},
          {name: 'content_scripts/content-0.js', size: 551151},
          {name: 'hero.gif', size: 1101005}
        ],
        entrypoints: {
          'background/service_worker': {
            assets: [{name: 'background/service_worker.js'}]
          },
          'sidebar/index': {
            assets: [{name: 'sidebar/index.js'}, {name: 'sidebar/index.css'}]
          },
          'content_scripts/content-1': {
            assets: [{name: 'content_scripts/content-1.js'}]
          },
          'content_scripts/content-0': {
            assets: [{name: 'content_scripts/content-0.js'}]
          }
        },
        time: 1039
      })
    }

    const output = messages.buildAssetsTree(stats as any)

    expect(output).toContain('.\n├─')
    expect(output).toContain('background')
    expect(output).toContain('service_worker.js')
    expect(output).toContain('sidebar')
    expect(output).toContain('03bc89f8e5771202.wasm')
    expect(output).not.toContain('Build completed')
    expect(output).not.toContain('Version:')
    expect(output).not.toContain('Size:')
    expect(output).not.toContain('Build Target:')
    expect(output).not.toContain('Build Status:')
    expect(output).not.toContain('Entrypoints')
    expect(output).not.toContain('Largest assets')
  })

  describe('option precedence (CLI > commands.build > defaults)', () => {
    function webpackOpts() {
      return (webpackConfig as any).mock.calls.at(-1)?.[1]
    }

    function makeGreenStats() {
      return {
        hasErrors: () => false,
        toJson: () => ({
          assets: [{name: 'background/service_worker.js', size: 1000}],
          warnings: [],
          errors: []
        })
      }
    }

    beforeEach(() => {
      ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
        return String(p).endsWith('node_modules')
      })
      ;(fs.readdirSync as any).mockReturnValue(['something'])
      rspackMock.mockReturnValue(makeCompiler(makeGreenStats()))
    })

    it('honors commands.build silent, zip, and polyfill (config-only)', async () => {
      const localLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({
        silent: true,
        zip: true,
        polyfill: true
      })

      await extensionBuild('/proj', {browser: 'chrome'})

      expect(webpackOpts()).toMatchObject({
        silent: true,
        zip: true,
        polyfill: true
      })
      const printed = localLogSpy.mock.calls.map((call) =>
        String(call[0] || '')
      )
      // Asset names only appear in the summary tree, which silent suppresses.
      expect(printed.some((line) => line.includes('service_worker.js'))).toBe(
        false
      )
      expect(
        printed.some((line) => line.includes('built for production in'))
      ).toBe(true)
    })

    it('lets explicit CLI flags beat config in both directions (both)', async () => {
      const localLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({
        silent: true,
        zip: true,
        polyfill: true
      })

      await extensionBuild('/proj', {
        browser: 'chrome',
        silent: false,
        zip: false,
        polyfill: false
      })

      expect(webpackOpts()).toMatchObject({
        silent: false,
        zip: false,
        polyfill: false
      })
      const printed = localLogSpy.mock.calls
        .map((call) => String(call[0] || ''))
        .join('\n')
      // Asset tree is back: file names only appear there.
      expect(printed).toContain('service_worker.js')
    })

    it('ignores undefined CLI keys so config is not clobbered', async () => {
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({
        zip: true,
        silent: true,
        polyfill: false
      })

      await extensionBuild('/proj', {
        browser: 'chrome',
        zip: undefined,
        silent: undefined,
        polyfill: undefined
      } as any)

      expect(webpackOpts()).toMatchObject({
        zip: true,
        silent: true,
        polyfill: false
      })
    })

    it('reads commands.build.browser when no browser is passed, and refuses a bad name', async () => {
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValue({
        browser: 'firefox'
      })
      await extensionBuild('/proj', {})
      expect(webpackOpts()).toMatchObject({browser: 'firefox'})

      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValue({
        browser: 'firefox'
      })
      await extensionBuild('/proj', {browser: 'edge'})
      expect(webpackOpts()).toMatchObject({browser: 'edge'})

      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValue({
        browser: 'nope'
      })
      await expect(extensionBuild('/proj', {})).rejects.toThrow(
        /Unsupported browser in extension.config commands.build.browser: nope/
      )
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValue({
        some: 'cmd',
        transpilePackages: ['@workspace/ui']
      })
    })

    it('honors the browser.* layer, with commands.build beating it', async () => {
      ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValueOnce({
        transpilePackages: ['@workspace/from-browser-layer'],
        zip: true,
        silent: true
      })
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({
        silent: false
      })

      await extensionBuild('/proj', {browser: 'chrome'})

      expect(webpackOpts()).toMatchObject({
        transpilePackages: ['@workspace/from-browser-layer'],
        zip: true,
        silent: false
      })
    })

    it('applies stock build defaults when neither config nor CLI sets a value', async () => {
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({})

      await extensionBuild('/proj', {browser: 'chrome'})

      expect(webpackOpts()).toMatchObject({
        polyfill: false,
        zip: false,
        zipSource: false,
        silent: false
      })
    })

    it('builds with commands.start values when start delegates the build', async () => {
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({
        polyfill: false
      })

      await extensionBuild('/proj', {
        browser: 'chrome',
        metadataCommand: 'start'
      })

      expect(configLoaderMod.loadCommandConfig).toHaveBeenCalledWith(
        '/proj',
        'start'
      )
      expect(webpackOpts()).toMatchObject({polyfill: false})
    })

    it('defaults the start-phase build to polyfill on and silent', async () => {
      ;(configLoaderMod.loadCommandConfig as any).mockResolvedValueOnce({})

      await extensionBuild('/proj', {
        browser: 'chrome',
        metadataCommand: 'start'
      })

      expect(webpackOpts()).toMatchObject({
        polyfill: true,
        silent: true
      })
    })
  })

  it('ensures dependencies before running the build', async () => {
    const nodeModules = path.join('/proj', 'node_modules')
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p) === nodeModules || false
    })
    ;(fs.readdirSync as any).mockReturnValue([])

    const stats = {hasErrors: () => false, toJson: () => ({assets: []})}
    rspackMock.mockReturnValue(makeCompiler(stats))

    await extensionBuild('/proj', {browser: 'chrome', silent: true})
    expect(ensureArtifactsMod.ensureDevelopArtifacts).toHaveBeenCalled()
  })

  it('resolves companion extensions before building', async () => {
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])

    const stats = {hasErrors: () => false, toJson: () => ({assets: []})}
    rspackMock.mockReturnValue(makeCompiler(stats))

    await extensionBuild('/proj', {
      browser: 'chrome',
      silent: true,
      extensions: [
        'https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi'
      ]
    })

    expect(
      resolveConfigMod.resolveCompanionExtensionsConfig
    ).toHaveBeenCalledWith({
      projectRoot: '/proj',
      browser: 'chrome',
      config: [
        'https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi'
      ]
    })
    expect(webpackConfig).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        extensions: {paths: ['/comp/a']},
        transpilePackages: ['@workspace/ui']
      })
    )
  })

  it('does not install dependencies in vitest mode and rejects instead of exiting when exitOnError=false', async () => {
    process.env.VITEST = 'true'
    ;(fs.existsSync as any).mockReturnValue(false)
    ;(fs.readdirSync as any).mockReturnValue([])

    const stats = {
      hasErrors: () => true,
      toString: () => 'Rspack: ModuleBuildError:\n\n\n'
    }
    rspackMock.mockReturnValue(makeCompiler(stats))

    await expect(
      extensionBuild('/proj', {
        browser: 'chrome',
        silent: true,
        exitOnError: false
      })
    ).rejects.toThrow(/Build failed with errors/)

    expect(ensureArtifactsMod.ensureDevelopArtifacts).toHaveBeenCalled()
  })

  it('rejects (never process.exit) on build errors BY DEFAULT, library hosts embed extensionBuild', async () => {
    const priorVitest = process.env.VITEST
    delete process.env.VITEST
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => undefined) as any)
    try {
      ;(fs.existsSync as any).mockReturnValue(false)
      ;(fs.readdirSync as any).mockReturnValue([])

      const stats = {
        hasErrors: () => true,
        toString: () => 'Rspack: ModuleBuildError:\n\n\n'
      }
      rspackMock.mockReturnValue(makeCompiler(stats))

      await expect(
        extensionBuild('/proj', {
          browser: 'chrome',
          silent: true
        })
      ).rejects.toThrow(/Build failed with errors/)

      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
      process.env.VITEST = priorVitest
    }
  })

  it('prints a build error when setup fails in non-author mode', async () => {
    const localErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    process.env.VITEST = 'true'
    // Nightly jobs export author mode, pin it off for this assertion.
    vi.stubEnv('EXTENSION_AUTHOR_MODE', 'false')
    ;(ensureArtifactsMod.ensureDevelopArtifacts as any).mockRejectedValueOnce(
      new Error('boom')
    )

    await expect(
      extensionBuild('/proj', {
        browser: 'chrome',
        silent: true,
        exitOnError: false
      })
    ).rejects.toThrow(/boom/)

    expect(localErrorSpy).toHaveBeenCalled()
    const message = localErrorSpy.mock.calls
      .map((call) => String(call[0] || ''))
      .join('\n')
    expect(message).toContain('boom')
    expect(message).toContain('Build failed with 1 error.')
  })

  it('skips user dependency install when install option is false', async () => {
    ;(fs.existsSync as any).mockReturnValue(false)
    ;(fs.readdirSync as any).mockReturnValue([])

    const stats = {hasErrors: () => false, toJson: () => ({assets: []})}
    rspackMock.mockReturnValue(makeCompiler(stats))

    await extensionBuild('/proj', {
      browser: 'chrome',
      silent: true,
      install: false
    })

    expect(
      ensureArtifactsMod.ensureUserProjectDependencies
    ).not.toHaveBeenCalled()
  })

  it('defaults to mode=production when --mode is not passed', async () => {
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])
    const stats = {hasErrors: () => false, toJson: () => ({assets: []})}
    rspackMock.mockReturnValue(makeCompiler(stats))

    await extensionBuild('/proj', {browser: 'chrome', silent: true})

    expect(webpackConfig).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({mode: 'production'})
    )
  })

  it('honors mode: development override and aligns NODE_ENV', async () => {
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])
    const stats = {hasErrors: () => false, toJson: () => ({assets: []})}
    rspackMock.mockReturnValue(makeCompiler(stats))
    const previousNodeEnv = process.env.NODE_ENV

    await extensionBuild('/proj', {
      browser: 'chrome',
      silent: true,
      mode: 'development'
    })

    expect(webpackConfig).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({mode: 'development'})
    )
    expect(process.env.NODE_ENV).toBe('development')
    process.env.NODE_ENV = previousNodeEnv
  })

  it('regenerates extension-env.d.ts for TS projects so CI tsc --noEmit stays clean', async () => {
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])
    ;(tsToolsMod as any).isUsingTypeScript.mockReturnValue(true)

    const stats = {hasErrors: () => false, toJson: () => ({assets: []})}
    rspackMock.mockReturnValue(makeCompiler(stats))

    await extensionBuild('/proj', {browser: 'chrome', silent: true})

    expect(tsToolsMod.ensureTypeScriptConfig).toHaveBeenCalledWith('/proj/src')
    expect(genTypesMod.generateExtensionTypes).toHaveBeenCalledWith(
      '/proj/src',
      '/proj'
    )
  })

  it('skips extension-env.d.ts regeneration on JS-only projects', async () => {
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])
    ;(tsToolsMod as any).isUsingTypeScript.mockReturnValue(false)

    const stats = {hasErrors: () => false, toJson: () => ({assets: []})}
    rspackMock.mockReturnValue(makeCompiler(stats))

    await extensionBuild('/proj', {browser: 'chrome', silent: true})

    expect(tsToolsMod.ensureTypeScriptConfig).toHaveBeenCalledWith('/proj/src')
    expect(genTypesMod.generateExtensionTypes).not.toHaveBeenCalled()
  })

  it('persists the build-summary contract for shell-out hosts', async () => {
    const os = await import('node:os')
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const tmp = realFs.mkdtempSync(path.join(os.tmpdir(), 'build-summary-'))
    const projectMod = await import('../lib/project')
    ;(projectMod.getProjectStructure as any).mockResolvedValueOnce({
      manifestPath: path.join(tmp, 'src', 'manifest.json'),
      packageJsonPath: path.join(tmp, 'package.json')
    })
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])

    const stats = {
      hasErrors: () => false,
      toJson: () => ({
        assets: [{name: 'a.js', size: 10}],
        warnings: [{message: '\u001b[33mDeprecation: legacy API\u001b[0m'}],
        errors: []
      })
    }
    rspackMock.mockReturnValue(makeCompiler(stats))

    try {
      await extensionBuild(tmp, {browser: 'chrome', silent: true})

      const summaryFile = path.join(
        tmp,
        'dist',
        'extension-js',
        'chrome',
        'build-summary.json'
      )
      expect(realFs.existsSync(summaryFile)).toBe(true)
      const persisted = JSON.parse(realFs.readFileSync(summaryFile, 'utf8'))
      expect(persisted.browser).toBe('chrome')
      expect(persisted.warnings_count).toBe(1)
      expect(persisted.warnings).toEqual(['Deprecation: legacy API'])
    } finally {
      realFs.rmSync(tmp, {recursive: true, force: true})
    }
  })

  it('names the dist it emitted into, in the summary and on disk', async () => {
    // Without this a host that shells out has to re-derive
    // `<project>/dist/<browser>` from the engine's own layout rules.
    const os = await import('node:os')
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const tmp = realFs.mkdtempSync(path.join(os.tmpdir(), 'build-outpath-'))
    const projectMod = await import('../lib/project')
    ;(projectMod.getProjectStructure as any).mockResolvedValueOnce({
      manifestPath: path.join(tmp, 'src', 'manifest.json'),
      packageJsonPath: path.join(tmp, 'package.json')
    })
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) =>
      String(p).endsWith('node_modules')
    )
    ;(fs.readdirSync as any).mockReturnValue(['something'])

    rspackMock.mockReturnValue(
      makeCompiler({hasErrors: () => false, toJson: () => ({assets: []})})
    )

    try {
      const summary = await extensionBuild(tmp, {
        browser: 'chrome',
        silent: true
      })

      expect(summary.output_path).toBe(path.join(tmp, 'dist', 'chrome'))

      const persisted = JSON.parse(
        realFs.readFileSync(
          path.join(
            tmp,
            'dist',
            'extension-js',
            'chrome',
            'build-summary.json'
          ),
          'utf8'
        )
      )
      expect(persisted.output_path).toBe(path.join(tmp, 'dist', 'chrome'))
    } finally {
      realFs.rmSync(tmp, {recursive: true, force: true})
    }
  })

  it('prints the receipt against a re-pointed output.path, not dist/<browser>', async () => {
    // A user config that re-points output.path emits there, so a receipt
    // naming dist/<browser> reads as a failed build to whoever looks there.
    const os = await import('node:os')
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const tmp = realFs.mkdtempSync(path.join(os.tmpdir(), 'build-custom-out-'))
    const customOut = path.join(tmp, 'artifacts', 'web')
    const projectMod = await import('../lib/project')
    ;(projectMod.getProjectStructure as any).mockResolvedValueOnce({
      manifestPath: path.join(tmp, 'src', 'manifest.json'),
      packageJsonPath: path.join(tmp, 'package.json')
    })
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) =>
      String(p).endsWith('node_modules')
    )
    ;(fs.readdirSync as any).mockReturnValue(['something'])
    ;(configLoaderMod as any).userConfigSpy.mockImplementationOnce(
      (cfg: any) => ({...cfg, output: {...cfg.output, path: customOut}})
    )

    rspackMock.mockReturnValue(
      makeCompiler({hasErrors: () => false, toJson: () => ({assets: []})})
    )

    // The file-level logSpy is unhooked by restoreAllMocks after each test,
    // so the receipt lines need their own capture here.
    const receiptLog = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await extensionBuild(tmp, {browser: 'chrome', silent: true})

      const printed = receiptLog.mock.calls
        .map((call) => call.join(' '))
        .join('\n')
      const receipt = printed
        .split('\n')
        .find((line) => line.includes('built for production in'))
      expect(receipt).toBeDefined()
      expect(receipt).toContain(customOut)
      expect(receipt).not.toContain(path.join(tmp, 'dist', 'chrome'))
      expect(printed).toContain(customOut)
    } finally {
      realFs.rmSync(tmp, {recursive: true, force: true})
    }
  })

  it('folds the safari packager identity into the summary it returns', async () => {
    // The generated dev.extensionjs.* bundle id was a log line and nothing
    // else, so a machine caller could not learn that its app is undistributable.
    const os = await import('node:os')
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs')
    const tmp = realFs.mkdtempSync(path.join(os.tmpdir(), 'build-safari-'))
    const projectMod = await import('../lib/project')
    ;(projectMod.getProjectStructure as any).mockResolvedValueOnce({
      manifestPath: path.join(tmp, 'src', 'manifest.json'),
      packageJsonPath: path.join(tmp, 'package.json')
    })
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) =>
      String(p).endsWith('node_modules')
    )
    ;(fs.readdirSync as any).mockReturnValue(['something'])

    rspackMock.mockReturnValue(
      makeCompiler({hasErrors: () => false, toJson: () => ({assets: []})})
    )

    const safariPackager = vi.fn(async () => ({
      appName: 'My App',
      bundleId: 'dev.extensionjs.My-App',
      bundleIdDerived: true,
      appPath: '/tmp/My App.app',
      macOsOnly: true
    }))

    try {
      const summary = await extensionBuild(tmp, {
        browser: 'safari',
        silent: true,
        safariPackager
      })

      expect(safariPackager).toHaveBeenCalledTimes(1)
      expect(summary.safari).toEqual({
        appName: 'My App',
        bundleId: 'dev.extensionjs.My-App',
        bundleIdDerived: true,
        appPath: '/tmp/My App.app',
        macOsOnly: true
      })

      const persisted = JSON.parse(
        realFs.readFileSync(
          path.join(
            tmp,
            'dist',
            'extension-js',
            'safari',
            'build-summary.json'
          ),
          'utf8'
        )
      )
      expect(persisted.safari.bundleIdDerived).toBe(true)
    } finally {
      realFs.rmSync(tmp, {recursive: true, force: true})
    }
  })

  it('rejects when compiler returns missing stats (prevents silent success)', async () => {
    process.env.VITEST = 'true'
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) => {
      return String(p).endsWith('node_modules')
    })
    ;(fs.readdirSync as any).mockReturnValue(['something'])

    rspackMock.mockReturnValue(makeCompiler(undefined))

    await expect(
      extensionBuild('/proj', {
        browser: 'chrome',
        silent: true,
        exitOnError: false
      })
    ).rejects.toThrow(/invalid stats output/i)
  })
})
