import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  type ExtensionProject,
  writeExtensionProject
} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// The server is where a dev session starts to compile and listen, so it is
// the one seam here. Everything before it reads a real project on disk.
const devServer = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))

vi.mock('../dev-server', () => ({devServer}))

// Kept real but for the two calls that would spawn a package manager.
vi.mock('../lib/ensure-develop-artifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ensure-develop-artifacts')>()),
  ensureDevelopArtifacts: vi.fn(async () => {}),
  ensureUserProjectDependencies: vi.fn(async () => {})
}))

import {extensionDev} from '../command-dev'
import * as ensureArtifactsMod from '../lib/ensure-develop-artifacts'

const tempFolder = trackTempFolders()

function project(options: ExtensionProject = {}): string {
  return writeExtensionProject(tempFolder('extjs-command-dev-'), options)
}

function devServerOptions(): any {
  return devServer.mock.calls[0]?.[1]
}

function pluginBrowserOptions(): any {
  return devServerOptions()?.browsersPlugin?.options?.browserOptions
}

describe('webpack/command-dev', () => {
  beforeEach(() => {
    devServer.mockReset()
    devServer.mockImplementation(async () => {})
    vi.mocked(ensureArtifactsMod.ensureDevelopArtifacts).mockClear()
    vi.mocked(ensureArtifactsMod.ensureUserProjectDependencies).mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('generates types for TS projects, installs dependencies if needed, and starts dev server with defaults', async () => {
    const root = project({
      manifest: {background: {service_worker: 'background.ts'}},
      files: {
        'background.ts': 'export const started: boolean = true\n',
        'tsconfig.json': {compilerOptions: {strict: true}}
      }
    })

    await extensionDev(root, {browser: undefined, port: 0} as any)

    expect(
      fs.readFileSync(path.join(root, 'extension-env.d.ts'), 'utf8')
    ).toContain('extension')

    expect(ensureArtifactsMod.ensureDevelopArtifacts).toHaveBeenCalled()
    expect(
      ensureArtifactsMod.ensureUserProjectDependencies
    ).toHaveBeenCalledWith(root)

    expect(devServer).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestPath: path.join(root, 'manifest.json'),
        packageJsonPath: path.join(root, 'package.json')
      }),
      expect.objectContaining({mode: 'development', browser: 'chromium'})
    )
  })

  it('writes no types file for a project with no TypeScript', async () => {
    const root = project({
      manifest: {background: {service_worker: 'background.js'}},
      files: {'background.js': 'console.log("started")\n'}
    })

    await extensionDev(root, {browser: undefined, port: 0} as any)

    expect(fs.existsSync(path.join(root, 'extension-env.d.ts'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'tsconfig.json'))).toBe(false)
    expect(devServer).toHaveBeenCalledTimes(1)
  })

  // The only TypeScript the build reaches is the Firefox background, so a
  // tsconfig is written only when the check runs for the config's browser.
  it.each([
    {config: `{commands: {dev: {browser: 'firefox'}}}`, scaffolds: true},
    {config: `{}`, scaffolds: false}
  ])('checks for TypeScript with the browser the config file names: $config', async ({
    config,
    scaffolds
  }) => {
    const root = project({
      manifest: {'firefox:background': {scripts: ['background.ts']}},
      config,
      files: {'background.ts': 'export const started: boolean = true\n'}
    })

    await extensionDev(root, {browser: undefined, port: 0} as any)

    expect(fs.existsSync(path.join(root, 'tsconfig.json'))).toBe(scaffolds)
  })

  // The only TypeScript is a page under the folder the config names, so the
  // check finds it only when it runs after that folder is remembered.
  it.each([
    {config: `{folders: {pages: 'app/pages'}}`, scaffolds: true},
    {config: `{}`, scaffolds: false}
  ])('checks for TypeScript in the folders the config file names: $config', async ({
    config,
    scaffolds
  }) => {
    const root = project({
      config,
      files: {
        'app/pages/panel.html':
          '<!doctype html><script src="./panel.ts"></script>\n',
        'app/pages/panel.ts': 'export const opened: boolean = true\n'
      }
    })

    await extensionDev(root, {browser: undefined, port: 0} as any)

    expect(fs.existsSync(path.join(root, 'tsconfig.json'))).toBe(scaffolds)
  })

  it('skips user dependency install when install option is false', async () => {
    await extensionDev(project(), {
      browser: undefined,
      port: 0,
      install: false
    } as any)

    expect(
      ensureArtifactsMod.ensureUserProjectDependencies
    ).not.toHaveBeenCalled()
  })

  it('hands the caller onReady to the dev server', async () => {
    const onReady = vi.fn()

    await extensionDev(project(), {browser: 'chrome', port: 0, onReady} as any)

    expect(devServer).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({onReady})
    )

    expect(onReady).not.toHaveBeenCalled()
  })

  it('forwards extension.config.js browser.profile to the BrowsersPlugin launcher', async () => {
    const root = project({
      config: `{
  browser: {
    chrome: {
      profile: '/explicit/profile',
      browserFlags: ['--my-flag'],
      persistProfile: true
    }
  }
}`
    })
    const launcher = vi.fn(async () => ({
      reload: vi.fn(async () => {}),
      enableUnifiedLogging: vi.fn(async () => {}),
      close: vi.fn(async () => {})
    }))

    await extensionDev(root, {browser: 'chrome', port: 0, launcher} as any)

    expect(pluginBrowserOptions()).toMatchObject({
      profile: '/explicit/profile',
      browserFlags: [
        '--my-flag',
        '--force-dark-mode',
        '--enable-features=WebUIDarkMode'
      ],
      persistProfile: true
    })
  })

  it('lets CLI devOptions.profile override extension.config.js profile', async () => {
    const root = project({
      config: `{browser: {chrome: {profile: '/from/config'}}}`
    })

    await extensionDev(root, {
      browser: 'chrome',
      port: 0,
      profile: '/from/cli',
      launcher: vi.fn()
    } as any)

    expect(pluginBrowserOptions().profile).toBe('/from/cli')
  })

  describe('option precedence (CLI > commands.dev > browser > defaults)', () => {
    it('applies stock defaults when neither config nor CLI sets a value', async () => {
      await extensionDev(project(), {
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
      expect(devServerOptions().polyfill).toBe(false)
    })

    it('lets commands.dev beat browser config and stock defaults (config-only)', async () => {
      const root = project({
        config: `{
  browser: {
    chrome: {startingUrl: 'https://from-browser.example', noOpen: false}
  },
  commands: {
    dev: {
      startingUrl: 'https://from-commands-dev.example',
      noOpen: true,
      logFormat: 'json',
      polyfill: true
    }
  }
}`
      })

      await extensionDev(root, {
        browser: 'chrome',
        port: 0,
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions()).toMatchObject({
        startingUrl: 'https://from-commands-dev.example',
        noOpen: true,
        logFormat: 'json'
      })

      expect(devServerOptions().polyfill).toBe(true)
    })

    it('lets browser config beat a top-level value and stock defaults', async () => {
      const root = project({
        config: `{
  startingUrl: 'https://from-top-level.example',
  browser: {chrome: {startingUrl: 'https://from-browser.example'}}
}`
      })

      await extensionDev(root, {
        browser: 'chrome',
        port: 0,
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions().startingUrl).toBe(
        'https://from-browser.example'
      )
    })

    it('honors commands.dev.browser when no CLI browser is given', async () => {
      const root = project({
        config: `{
  browser: {
    chrome: {startingUrl: 'https://chrome-layer.example'},
    firefox: {startingUrl: 'https://firefox-layer.example'}
  },
  commands: {dev: {browser: 'firefox'}}
}`
      })

      await extensionDev(root, {
        browser: undefined,
        port: 0,
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions().browser).toBe('firefox')
      expect(devServerOptions().browser).toBe('firefox')
      // The browser layer read is the one of the browser the config picked.
      expect(pluginBrowserOptions().startingUrl).toBe(
        'https://firefox-layer.example'
      )
    })

    it('refuses a commands.dev.browser it does not know, with a code', async () => {
      const root = project({config: `{commands: {dev: {browser: 'netscape'}}}`})

      await expect(
        extensionDev(root, {browser: undefined, port: 0} as any)
      ).rejects.toMatchObject({
        code: 'E_UNSUPPORTED_BROWSER',
        message: expect.stringContaining('commands.dev.browser: netscape')
      })

      expect(devServer).not.toHaveBeenCalled()
    })

    it('refuses a browser option it does not know, with a code', async () => {
      await expect(
        extensionDev(project(), {browser: 'netscape', port: 0} as any)
      ).rejects.toMatchObject({code: 'E_UNSUPPORTED_BROWSER'})

      expect(devServer).not.toHaveBeenCalled()
    })

    it('targets chromium when neither the call nor the config names a browser', async () => {
      await extensionDev(project(), {port: 0, launcher: vi.fn()} as any)

      expect(pluginBrowserOptions().browser).toBe('chromium')
      expect(devServerOptions().browser).toBe('chromium')
    })

    it('lets a binary with no browser name pick its own family', async () => {
      await extensionDev(project(), {
        port: 0,
        geckoBinary: '/opt/gecko/firefox',
        launcher: vi.fn()
      } as any)

      expect(devServerOptions().browser).toBe('gecko-based')
    })

    it('lets an explicit CLI browser beat commands.dev.browser', async () => {
      const root = project({config: `{commands: {dev: {browser: 'firefox'}}}`})

      await extensionDev(root, {
        browser: 'edge',
        port: 0,
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions().browser).toBe('edge')
      expect(devServerOptions().browser).toBe('edge')
    })

    it('lets explicit CLI values beat commands.dev in both directions (both)', async () => {
      const root = project({
        config: `{
  commands: {
    dev: {
      startingUrl: 'https://from-commands-dev.example',
      noOpen: true,
      logFormat: 'json',
      polyfill: false,
      logColor: false
    }
  }
}`
      })

      await extensionDev(root, {
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
      await extensionDev(project(), {
        browser: 'chrome',
        port: 0,
        polyfill: true,
        logFormat: 'ndjson',
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions()).toMatchObject({
        logFormat: 'ndjson',
        logTimestamps: true
      })

      expect(devServerOptions().polyfill).toBe(true)
    })

    it('concatenates browserFlags and deep-merges preferences across layers', async () => {
      const root = project({
        config: `{
  browser: {
    chrome: {
      browserFlags: ['--from-browser'],
      excludeBrowserFlags: ['--exclude-browser'],
      preferences: {a: 1, nested: {x: 1}}
    }
  },
  commands: {
    dev: {
      browserFlags: ['--from-command'],
      excludeBrowserFlags: ['--exclude-command'],
      preferences: {b: 2, nested: {y: 2}}
    }
  }
}`
      })

      await extensionDev(root, {
        browser: 'chrome',
        port: 0,
        browserFlags: ['--from-cli'],
        preferences: {a: 99, nested: {x: 3}},
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions()).toMatchObject({
        browserFlags: [
          '--from-browser',
          '--from-command',
          '--from-cli',
          '--force-dark-mode',
          '--enable-features=WebUIDarkMode'
        ],
        excludeBrowserFlags: ['--exclude-browser', '--exclude-command'],
        preferences: {a: 99, b: 2, nested: {x: 3, y: 2}}
      })
    })

    it('applies the same dark appearance defaults as preview and start', async () => {
      await extensionDev(project(), {
        browser: 'chrome',
        port: 0,
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions().browserFlags).toEqual([
        '--force-dark-mode',
        '--enable-features=WebUIDarkMode'
      ])
    })

    it('lets excludeBrowserFlags drop the stock dark flags', async () => {
      await extensionDev(project(), {
        browser: 'chrome',
        port: 0,
        excludeBrowserFlags: ['--force-dark-mode'],
        launcher: vi.fn()
      } as any)

      expect(pluginBrowserOptions().browserFlags || []).not.toContain(
        '--force-dark-mode'
      )

      expect(pluginBrowserOptions().browserFlags || []).not.toContain(
        '--enable-features=WebUIDarkMode'
      )
    })
  })

  it('prints contract errors once, clean, without a stack trace, on the path that exits', async () => {
    const printed = vi.mocked(console.error)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1')
    })
    // Nightly jobs export author mode, pin it off for this assertion.
    vi.stubEnv('EXTENSION_AUTHOR_MODE', 'false')

    devServer.mockImplementationOnce(async () => {
      throw new Error(
        '[Extension.js] Missing tsconfig.json next to package.json. Create one to use TypeScript.'
      )
    })

    await expect(
      extensionDev(project(), {browser: 'chrome', exitOnError: true} as any)
    ).rejects.toThrow('exit 1')

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(printed).toHaveBeenCalledTimes(1)
    const line = printed.mock.calls[0][0]
    expect(typeof line).toBe('string')
    expect(line).toMatch(/Missing tsconfig\.json/)
    expect(line).not.toMatch(/\n\s+at /)
  })

  // The package root holds the config and the dependency, and the manifest
  // sits one folder down, so the warning proves which folder was read.
  it('checks managed dependency conflicts against the package root when the manifest is in src', async () => {
    const root = project({
      manifestFile: 'src/manifest.json',
      packageJson: {devDependencies: {'@rspack/core': '1.0.0'}},
      config: `{config: (config) => config} // loads '@rspack/core'`
    })

    await extensionDev(root, {browser: 'chrome', port: 0} as any)

    expect(devServerOptions()).toBeDefined()
    expect(devServer.mock.calls[0][0]).toMatchObject({
      manifestPath: path.join(root, 'src', 'manifest.json'),
      packageJsonPath: path.join(root, 'package.json')
    })

    const warned = vi
      .mocked(console.warn)
      .mock.calls.map((call) => String(call[0]))
      .join('\n')

    expect(warned).toContain('@rspack/core')
    expect(warned).toContain('extension.config.js')
  })

  it('rejects on failure so the CLI wrapper can frame or exit it', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1')
    })

    devServer.mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    // Library contract: no exitOnError means reject, never process.exit; the
    // CLI wrapper opts into exiting on its pretty path.
    await expect(
      extensionDev(project(), {browser: 'firefox'} as any)
    ).rejects.toThrow('boom')

    expect(exitSpy).not.toHaveBeenCalled()
    // The caller holds the rejection, so printing it here would show it twice.
    expect(console.error).not.toHaveBeenCalled()
  })

  it('keeps the human lines on stderr when a caller frames a later failure for a machine', async () => {
    const printed = vi.mocked(console.error)
    const root = project()
    const nowhere = path.join(root, 'no-such-folder')

    vi.stubEnv('EXTENSION_OUTPUT', 'json')
    vi.stubEnv('EXTENSION_AUTHOR_MODE', 'false')

    devServer.mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    await expect(
      extensionDev(root, {browser: 'firefox'} as any)
    ).rejects.toThrow('boom')

    expect(printed).toHaveBeenCalledTimes(1)
    expect(String(printed.mock.calls[0][0])).toContain('boom')
    expect(String(printed.mock.calls[0][0])).not.toMatch(/\n\s+at /)

    // A project that is not found is the whole answer, and the frame has it.
    printed.mockClear()

    await expect(
      extensionDev(nowhere, {browser: 'firefox'} as any)
    ).rejects.toThrow(/manifest/i)

    expect(printed).not.toHaveBeenCalled()
    expect(devServer).toHaveBeenCalledTimes(1)
  })

  it('hands the failure to onExitError only on the path that exits', async () => {
    const failure = new Error('boom')
    const onExitError = vi.fn()
    const printed = vi.mocked(console.error)
    const root = project()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 1')
    })

    devServer.mockImplementation(async () => {
      throw failure
    })

    await expect(
      extensionDev(root, {browser: 'firefox', onExitError} as any)
    ).rejects.toThrow('boom')

    expect(onExitError).not.toHaveBeenCalled()

    printed.mockClear()

    await expect(
      extensionDev(root, {
        browser: 'firefox',
        exitOnError: true,
        onExitError
      } as any)
    ).rejects.toThrow('exit 1')

    expect(onExitError).toHaveBeenCalledTimes(1)
    expect(onExitError).toHaveBeenCalledWith(failure)
    expect(exitSpy).toHaveBeenCalledWith(1)
    // The report comes after the one printed block and before the exit.
    expect(printed).toHaveBeenCalledTimes(1)
    expect(printed.mock.invocationCallOrder[0]).toBeLessThan(
      onExitError.mock.invocationCallOrder[0]
    )

    expect(onExitError.mock.invocationCallOrder[0]).toBeLessThan(
      exitSpy.mock.invocationCallOrder[0]
    )
  })
})
