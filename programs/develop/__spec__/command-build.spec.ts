import {AsyncLocalStorage} from 'node:async_hooks'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  type ExtensionProject,
  writeExtensionProject
} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

// Both run for real. The spies say whether an install was asked for, and a
// test arms the first to fail the setup, which no project on disk can do.
vi.mock('../lib/ensure-develop-artifacts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/ensure-develop-artifacts')>()

  return {
    ...actual,
    ensureDevelopArtifacts: vi.fn(actual.ensureDevelopArtifacts),
    ensureUserProjectDependencies: vi.fn(actual.ensureUserProjectDependencies)
  }
})

const bundler = vi.hoisted(() => ({compiler: undefined as unknown}))

// The real bundler, unless a test arms a compiler that calls back with no
// result, which a real compile never does.
vi.mock('@rspack/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rspack/core')>()

  return {
    ...actual,
    rspack: new Proxy(actual.rspack, {
      apply: (target, self, args) =>
        bundler.compiler ?? Reflect.apply(target, self, args)
    })
  }
})

import {extensionBuild} from '../command-build'
import {getBuildToolchain} from '../lib/build-toolchain'
import * as ensureArtifactsMod from '../lib/ensure-develop-artifacts'
import {buildSummaryPath, readyContractPath} from '../lib/session-paths'
import type {BuildOptions, SafariPackagerFn} from '../types'
import {buildProject} from './helpers/build-project'

const tempFolder = trackTempFolders()

const STORE_ID = 'fmkadmapgofadopljbjfkapdkoienihi'
const STORE_LINK = `https://chromewebstore.google.com/detail/react-developer-tools/${STORE_ID}`

// A background script alone, the smallest project that compiles a module.
function project(options: ExtensionProject = {}): string {
  return writeExtensionProject(tempFolder('extjs-command-build-'), {
    ...options,
    manifest: {
      background: {service_worker: 'background.js'},
      ...options.manifest
    },
    files: {'background.js': 'console.log("started")\n', ...options.files}
  })
}

// Reads the browser namespace, so the bundle differs with the polyfill.
function polyfillProject(config?: string): string {
  return project({
    config,
    files: {
      'background.js': 'browser.runtime.onInstalled.addListener(() => {})\n'
    }
  })
}

// The polyfill is a few kilobytes and the script without it is one line.
function shipsPolyfill(root: string, browser = 'chrome'): boolean {
  const bundle = path.join(
    root,
    'dist',
    browser,
    'background',
    'service_worker.js'
  )

  return fs.statSync(bundle).size > 2000
}

// The config of a project whose one plugin runs the given body when applied.
function pluginConfig(body: string): string {
  return `{
  config: (config) => {
    config.plugins.push({
      apply(compiler) {
        const fs = require('node:fs')
        const path = require('node:path')
        ${body}
      }
    })
    return config
  }
}`
}

const EMIT_NOTHING = pluginConfig(
  "compiler.hooks.shouldEmit.tap('spec-emit-nothing', () => false)"
)

// A bundler that reports an error of its own, with no compile error behind it.
const BUNDLER_EXPLODES = pluginConfig(
  `compiler.hooks.beforeRun.tapPromise('spec-explode', async () => {
          throw new Error('bundler exploded')
        })`
)

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function filesUnder(folder: string): string[] {
  return fs
    .readdirSync(folder, {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(folder, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/')
    )
    .sort()
}

function zipsUnder(root: string): string[] {
  return filesUnder(root).filter((file) => file.endsWith('.zip'))
}

// eslint-disable-next-line no-control-regex
const withoutColors = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '')

function printed(channel: 'log' | 'warn' | 'error'): string {
  return withoutColors(
    vi
      .mocked(console[channel])
      .mock.calls.map((call) => call.map(String).join(' '))
      .join('\n')
  )
}

type BuildFailure = Error & {code?: string; cause?: unknown}

async function failureOf(build: Promise<unknown>): Promise<BuildFailure> {
  try {
    await build
  } catch (error) {
    return error as BuildFailure
  }

  throw new Error('The build was expected to fail and it resolved.')
}

describe('webpack/command-build', () => {
  beforeEach(() => {
    bundler.compiler = undefined
    vi.mocked(ensureArtifactsMod.ensureDevelopArtifacts).mockClear()
    vi.mocked(ensureArtifactsMod.ensureUserProjectDependencies).mockClear()
    // Nightly jobs export author mode, and a host may ask for machine output.
    vi.stubEnv('EXTENSION_AUTHOR_MODE', 'false')
    vi.stubEnv('EXTENSION_DEBUG', '')
    vi.stubEnv('EXTENSION_OUTPUT', '')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('builds successfully, passes the plugins on, merges user config, and returns summary', async () => {
    const root = project({
      config: `{
  config: (config, context) => {
    require('node:fs').writeFileSync(
      require('node:path').join(__dirname, 'hook.json'),
      JSON.stringify({
        browser: context.browser,
        mode: context.mode,
        command: context.command,
        bundler: typeof context.rspack,
        plugins: config.plugins.map((plugin) => plugin.constructor.name)
      })
    )
    config.plugins.push({
      apply(compiler) {
        compiler.hooks.thisCompilation.tap('spec-merged', (compilation) => {
          compilation.hooks.processAssets.tap('spec-merged', () => {
            compilation.emitAsset(
              'merged.txt',
              new compiler.rspack.sources.RawSource('merged')
            )
          })
        })
      }
    })
    return config
  }
}`
    })

    const summary = await extensionBuild(root, {
      browser: 'chrome',
      silent: true
    })
    const dist = path.join(root, 'dist', 'chrome')
    const written = filesUnder(dist)
    const sizes = written.map((file) => fs.statSync(path.join(dist, file)).size)

    // The asset the hook's plugin emits is on disk beside the engine's own.
    expect(written).toEqual([
      'background/service_worker.js',
      'manifest.json',
      'merged.txt'
    ])

    expect(summary).toEqual({
      browser: 'chrome',
      buildType: 'production',
      output_path: dist,
      total_assets: 3,
      total_bytes: sizes.reduce((total, size) => total + size, 0),
      largest_asset_bytes: Math.max(...sizes),
      warnings_count: 0,
      errors_count: 0,
      addon_lint: {status: 'skipped', reason: 'browser'},
      toolchain: getBuildToolchain()
    })

    // The hook is told the run's browser, mode and command, and is handed
    // the engine's own plugins, the receipt writer included.
    const hook = readJson(path.join(root, 'hook.json'))

    expect(hook).toMatchObject({
      browser: 'chrome',
      mode: 'production',
      command: 'build',
      bundler: 'function'
    })

    expect(hook.plugins).toEqual(
      expect.arrayContaining(['plugin-compilation', 'plugin-playwright'])
    )
  })

  it('closes a clean build with the built-for-production line', async () => {
    const root = project()

    await buildProject(root, {silent: false})

    const lines = printed('log').split('\n')

    expect(
      lines.some((line) =>
        line.includes(
          `built for production in ${path.join(root, 'dist', 'chrome')}`
        )
      )
    ).toBe(true)

    expect(lines.some((line) => line.includes('Build succeeded'))).toBe(false)
    expect(lines.some((line) => line.includes('ready for deployment'))).toBe(
      false
    )
  })

  it('prints one packaged receipt per zip artifact after the closer', async () => {
    const root = project()

    const summary = await buildProject(root, {silent: false, zip: true})

    const [zip] = zipsUnder(root)
    const zipPath = path.join(root, zip)

    expect(zipsUnder(root)).toHaveLength(1)
    expect(summary.zip_artifacts).toEqual([
      {kind: 'dist', path: zipPath, size: fs.statSync(zipPath).size}
    ])

    const output = printed('log')

    expect(output.split('Packaged').length).toBe(2)
    expect(output).toContain(
      `Packaged ${zipPath} (${fs.statSync(zipPath).size} B)`
    )

    const closerAt = output.indexOf('built for production in')
    const receiptAt = output.indexOf('Packaged')

    expect(closerAt).toBeGreaterThanOrEqual(0)
    expect(receiptAt).toBeGreaterThan(closerAt)
  })

  it('ends a failed build with one error-count closer', async () => {
    const root = project({
      files: {'background.js': 'import "./absent.js"\nimport "./gone.js"\n'}
    })

    await expect(buildProject(root, {exitOnError: false})).rejects.toThrow(
      /Build failed with errors/
    )

    const errors = printed('error')

    expect(errors).toContain('Build failed with 2 errors.')
    expect(errors.match(/Build failed with \d+ error/g)?.length).toBe(1)
  })

  it('prints warning details and still closes on the success channel', async () => {
    // The engine turns the bundler's size hints off, so the project's own
    // config turns them back on with a limit its one script is over.
    const root = project({
      config: `{
  config: (config) => ({
    ...config,
    performance: {hints: 'warning', maxAssetSize: 2048, maxEntrypointSize: 2048}
  })
}`,
      files: {
        'background.js': `console.log(${JSON.stringify('x'.repeat(4096))})\n`
      }
    })

    const summary = await buildProject(root, {silent: false})

    expect(summary.warnings_count).toBe(summary.warnings?.length)
    expect(summary.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^asset size limit: /),
        expect.stringMatching(/^entrypoint size limit: /)
      ])
    )

    const output = printed('log')

    expect(output).toContain('Performance: asset size limit exceeded')
    expect(output).toContain('Threshold: 2.000 KiB')
    expect(output).toContain('Source:')
    expect(output).toContain('Hint:')
    expect(output).toContain('Performance: entrypoint size limit exceeded')
    expect(output).not.toContain('Assets over limit')
    expect(output).not.toContain('Build succeeded')

    const warningsAt = output.indexOf('Performance: asset size limit exceeded')
    const closerAt = output.indexOf('built for production in')

    expect(closerAt).toBeGreaterThan(warningsAt)
  })

  it('formats build output with the original asset tree', async () => {
    const root = project({
      manifest: {
        action: {default_popup: 'popup/index.html'},
        content_scripts: [
          {matches: ['https://example.com/*'], js: ['content/script.js']}
        ]
      },
      files: {
        'popup/index.html':
          '<!doctype html><link rel="stylesheet" href="./index.css"><script src="./index.js"></script>\n',
        'popup/index.css': 'body {margin: 0}\n',
        'popup/index.js': 'console.log("popup")\n',
        'content/script.js': 'console.log("content")\n'
      }
    })

    await buildProject(root, {silent: false})

    const output = printed('log')

    expect(output).toContain('.\n├─')
    expect(output).toContain('background')
    expect(output).toContain('service_worker.js')
    expect(output).toContain('content_scripts')
    expect(output).toContain('index.css')
    expect(output).not.toContain('Build completed')
    expect(output).not.toContain('Version:')
    expect(output).not.toContain('Size:')
    expect(output).not.toContain('Build Target:')
    expect(output).not.toContain('Build Status:')
    expect(output).not.toContain('Entrypoints')
    expect(output).not.toContain('Largest assets')
  })

  describe('option precedence (CLI > commands.build > defaults)', () => {
    it('honors commands.build silent, zip, and polyfill (config-only)', async () => {
      const root = polyfillProject(
        '{commands: {build: {silent: true, zip: true, polyfill: true}}}'
      )

      await extensionBuild(root, {browser: 'chrome', install: false})

      expect(zipsUnder(root)).toHaveLength(1)
      expect(shipsPolyfill(root)).toBe(true)
      // A silent build answers through its summary and prints no line.
      expect(vi.mocked(console.log).mock.calls).toEqual([])
    })

    it('lets explicit CLI flags beat config in both directions (both)', async () => {
      const root = polyfillProject(
        '{commands: {build: {silent: true, zip: true, polyfill: true}}}'
      )

      await extensionBuild(root, {
        browser: 'chrome',
        install: false,
        silent: false,
        zip: false,
        polyfill: false
      })

      expect(zipsUnder(root)).toEqual([])
      expect(shipsPolyfill(root)).toBe(false)
      // Asset tree is back: file names only appear there.
      expect(printed('log')).toContain('service_worker.js')
    })

    it('ignores undefined CLI keys so config is not clobbered', async () => {
      const root = polyfillProject(
        '{commands: {build: {zip: true, silent: true, polyfill: false}}}'
      )

      await extensionBuild(root, {
        browser: 'chrome',
        install: false,
        zip: undefined,
        silent: undefined,
        polyfill: undefined
      } as BuildOptions)

      expect(zipsUnder(root)).toHaveLength(1)
      expect(vi.mocked(console.log).mock.calls).toEqual([])
      expect(shipsPolyfill(root)).toBe(false)
    })

    it('reads commands.build.browser when no browser is passed, and refuses a bad name', async () => {
      const root = project({
        config: "{commands: {build: {browser: 'firefox'}}}"
      })

      const fromConfig = await extensionBuild(root, {
        silent: true,
        install: false,
        addonLint: false
      } as BuildOptions)

      expect(fromConfig.browser).toBe('firefox')
      expect(
        fs.existsSync(path.join(root, 'dist', 'firefox', 'manifest.json'))
      ).toBe(true)

      expect(fs.existsSync(path.join(root, 'dist', 'chromium'))).toBe(false)

      const fromFlag = await buildProject(root, {browser: 'edge'})

      expect(fromFlag.browser).toBe('edge')
      expect(fs.existsSync(path.join(root, 'dist', 'edge'))).toBe(true)

      const misnamed = project({
        config: "{commands: {build: {browser: 'nope'}}}"
      })

      await expect(
        extensionBuild(misnamed, {silent: true, install: false} as BuildOptions)
      ).rejects.toThrow(
        /Unsupported browser in extension.config commands.build.browser: nope/
      )

      expect(fs.existsSync(path.join(misnamed, 'dist'))).toBe(false)
    })

    it('honors the browser.* layer, with commands.build beating it', async () => {
      // The package ships TypeScript, which compiles only when it is listed.
      const files = {
        'node_modules/@workspace/from-browser-layer/package.json': {
          name: '@workspace/from-browser-layer',
          version: '1.0.0',
          main: 'index.ts'
        },
        'node_modules/@workspace/from-browser-layer/index.ts':
          'export const label: string = "from the browser layer"\n',
        'background.js':
          'import {label} from "@workspace/from-browser-layer"\nconsole.log(label)\n'
      }
      const root = project({
        files,
        config: `{
  browser: {
    chrome: {
      transpilePackages: ['@workspace/from-browser-layer'],
      zip: true,
      silent: true
    }
  },
  commands: {build: {silent: false}}
}`
      })

      await extensionBuild(root, {browser: 'chrome', install: false})

      expect(
        fs.readFileSync(
          path.join(root, 'dist', 'chrome', 'background', 'service_worker.js'),
          'utf8'
        )
      ).toContain('from the browser layer')

      expect(zipsUnder(root)).toHaveLength(1)
      expect(printed('log')).toContain('service_worker.js')

      // The same project with no browser layer does not compile the package.
      const unlisted = project({files})

      await expect(buildProject(unlisted)).rejects.toMatchObject({
        code: 'E_COMPILE'
      })
    })

    it('applies stock build defaults when neither config nor CLI sets a value', async () => {
      const root = polyfillProject()

      const summary = await extensionBuild(root, {
        browser: 'chrome',
        install: false
      })

      expect(shipsPolyfill(root)).toBe(false)
      expect(zipsUnder(root)).toEqual([])
      expect(summary.zip_artifacts).toBeUndefined()
      expect(printed('log')).toContain('service_worker.js')
    })

    it('builds with commands.start values when start delegates the build', async () => {
      const root = polyfillProject(
        '{commands: {build: {polyfill: true}, start: {polyfill: false}}}'
      )

      await extensionBuild(root, {
        browser: 'chrome',
        install: false,
        metadataCommand: 'start'
      })

      expect(shipsPolyfill(root)).toBe(false)
      expect(readJson(readyContractPath(root, 'chrome')).command).toBe('start')
    })

    it('defaults the start-phase build to polyfill off and silent', async () => {
      const root = polyfillProject()

      await extensionBuild(root, {
        browser: 'chrome',
        install: false,
        metadataCommand: 'start'
      })

      expect(shipsPolyfill(root)).toBe(false)
      // The start leg still speaks for its session, the asset tree aside.
      expect(printed('log')).toContain('built for production in')
      expect(printed('log')).not.toContain('service_worker.js')
    })

    it('turns the start-phase polyfill on from commands.start', async () => {
      const root = polyfillProject('{commands: {start: {polyfill: true}}}')

      await extensionBuild(root, {
        browser: 'chrome',
        install: false,
        metadataCommand: 'start'
      })

      expect(shipsPolyfill(root)).toBe(true)
    })
  })

  it('ensures dependencies before running the build', async () => {
    const root = project()
    let builtAtSetup: boolean | undefined

    vi.mocked(ensureArtifactsMod.ensureDevelopArtifacts).mockImplementationOnce(
      async () => {
        builtAtSetup = fs.existsSync(path.join(root, 'dist'))
      }
    )

    await extensionBuild(root, {browser: 'chrome', silent: true})

    expect(ensureArtifactsMod.ensureDevelopArtifacts).toHaveBeenCalledTimes(1)
    expect(builtAtSetup).toBe(false)
    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(true)
  })

  it('downloads no companion for a build, and resolves them for the start leg', async () => {
    const built = project()

    await buildProject(built, {extensions: [STORE_LINK]})

    expect(fs.existsSync(path.join(built, 'extensions'))).toBe(false)
    expect(
      readJson(readyContractPath(built, 'chrome')).managedExtensions
    ).toBeUndefined()

    // The folder an earlier download left, so the start leg reads the disk.
    const started = project({
      files: {
        [`extensions/chrome/${STORE_ID}/manifest.json`]: {
          manifest_version: 3,
          name: 'companion',
          version: '1.0.0'
        }
      }
    })

    await buildProject(started, {
      metadataCommand: 'start',
      extensions: [STORE_LINK]
    })

    expect(
      readJson(readyContractPath(started, 'chrome')).managedExtensions
    ).toEqual([
      {
        path: path.join(started, 'extensions', 'chrome', STORE_ID),
        id: expect.any(String)
      }
    ])
  })

  it('checks its own artifacts and rejects instead of exiting when exitOnError=false', async () => {
    const root = project({files: {'background.js': 'const = ;\n'}})

    await expect(
      extensionBuild(root, {
        browser: 'chrome',
        silent: true,
        exitOnError: false
      })
    ).rejects.toThrow(/Build failed with errors/)

    expect(ensureArtifactsMod.ensureDevelopArtifacts).toHaveBeenCalled()
  })

  it('rejects (never process.exit) on build errors BY DEFAULT, library hosts embed extensionBuild', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((_code?: number) => undefined) as never)
    const root = project({files: {'background.js': 'const = ;\n'}})

    await expect(
      extensionBuild(root, {browser: 'chrome', silent: true})
    ).rejects.toThrow(/Build failed with errors/)

    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('prints a build error when setup fails in non-author mode', async () => {
    const root = project()

    vi.mocked(ensureArtifactsMod.ensureDevelopArtifacts).mockRejectedValueOnce(
      new Error('boom')
    )

    await expect(
      extensionBuild(root, {
        browser: 'chrome',
        silent: true,
        exitOnError: false
      })
    ).rejects.toThrow(/boom/)

    const errors = printed('error')

    expect(errors).toContain('boom')
    expect(errors).toContain('Build failed with 1 error.')
    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false)
  })

  it('skips user dependency install when install option is false', async () => {
    const root = project()

    await extensionBuild(root, {
      browser: 'chrome',
      silent: true,
      install: false
    })

    expect(
      ensureArtifactsMod.ensureUserProjectDependencies
    ).not.toHaveBeenCalled()

    await extensionBuild(root, {browser: 'chrome', silent: true})

    expect(
      ensureArtifactsMod.ensureUserProjectDependencies
    ).toHaveBeenCalledWith(root)
  })

  it('defaults to mode=production when --mode is not passed', async () => {
    const root = project({
      config: `{
  config: (config, context) => {
    require('node:fs').writeFileSync(
      require('node:path').join(__dirname, 'mode.json'),
      JSON.stringify({context: context.mode, config: config.mode})
    )
    return config
  }
}`
    })

    const summary = await buildProject(root)

    expect(readJson(path.join(root, 'mode.json'))).toEqual({
      context: 'production',
      config: 'production'
    })

    expect(summary.buildType).toBe('production')
  })

  it('sets NODE_ENV for the compile and hands the caller back its own', async () => {
    // The plugin is applied as the compiler is made, which is the moment the
    // compile reads NODE_ENV. A file named explode makes it throw instead.
    const root = project({
      config: pluginConfig(
        `if (fs.existsSync(path.join(__dirname, 'explode'))) {
          throw new Error('no compiler')
        }
        fs.appendFileSync(
          path.join(__dirname, 'node-env.log'),
          String(process.env.NODE_ENV) + '\\n'
        )`
      )
    })

    vi.stubEnv('NODE_ENV', 'test')

    const development = await buildProject(root, {mode: 'development'})

    expect(development.buildType).toBe('development')

    await buildProject(root)
    await buildProject(root, {mode: 'none'})

    expect(
      fs
        .readFileSync(path.join(root, 'node-env.log'), 'utf8')
        .trim()
        .split('\n')
    ).toEqual(['development', 'production', 'test'])

    expect(process.env.NODE_ENV).toBe('test')

    // A failed build hands it back too.
    fs.writeFileSync(path.join(root, 'explode'), '')

    await expect(buildProject(root)).rejects.toThrow('no compiler')

    expect(process.env.NODE_ENV).toBe('test')
  })

  it('checks for TypeScript only after the folders config is remembered', async () => {
    // The only TypeScript is a page under the folder the config names, so
    // the check finds it only when it runs after that folder is remembered.
    const files = {
      'app/pages/panel.html':
        '<!doctype html><script src="./panel.ts"></script>\n',
      'app/pages/panel.ts': 'export const opened: boolean = true\n'
    }
    const named = project({config: "{folders: {pages: 'app/pages'}}", files})
    const unnamed = project({files})

    await buildProject(named)
    await buildProject(unnamed)

    expect(fs.existsSync(path.join(named, 'tsconfig.json'))).toBe(true)
    expect(fs.existsSync(path.join(unnamed, 'tsconfig.json'))).toBe(false)
  })

  it('regenerates extension-env.d.ts for TS projects so CI tsc --noEmit stays clean', async () => {
    const root = project({
      manifest: {background: {service_worker: 'background.ts'}},
      files: {'background.ts': 'export const started: boolean = true\n'}
    })
    const types = path.join(root, 'extension-env.d.ts')

    await buildProject(root)

    expect(fs.existsSync(path.join(root, 'tsconfig.json'))).toBe(true)
    expect(fs.readFileSync(types, 'utf8')).toContain('extension')

    fs.rmSync(types)
    await buildProject(root)

    expect(fs.readFileSync(types, 'utf8')).toContain('extension')
  })

  it('skips extension-env.d.ts regeneration on JS-only projects', async () => {
    const root = project()

    await buildProject(root)

    expect(fs.existsSync(path.join(root, 'extension-env.d.ts'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'tsconfig.json'))).toBe(false)
  })

  it('persists the build-summary contract for shell-out hosts', async () => {
    const root = project({
      config: pluginConfig(
        `compiler.hooks.thisCompilation.tap('spec-warn', (compilation) => {
          compilation.warnings.push(
            new Error('\\u001b[33mDeprecation: legacy API\\u001b[0m')
          )
        })`
      )
    })

    await buildProject(root)

    const summaryFile = buildSummaryPath(root, 'chrome')

    expect(summaryFile).toBe(
      path.join(root, 'dist', 'extension-js', 'chrome', 'build-summary.json')
    )

    const persisted = readJson(summaryFile)

    expect(persisted.browser).toBe('chrome')
    expect(persisted.warnings_count).toBe(1)
    expect(persisted.warnings).toEqual(['Deprecation: legacy API'])
  })

  it('stamps a production build as buildType production in the summary', async () => {
    const root = project()

    const summary = await buildProject(root)

    expect(summary.buildType).toBe('production')

    const persisted = readJson(buildSummaryPath(root, 'chrome'))

    expect(persisted.buildType).toBe('production')
    expect(Object.keys(persisted).slice(0, 2)).toEqual(['browser', 'buildType'])
  })

  it('stamps a development mode build as buildType development in the summary', async () => {
    const root = project()

    const summary = await buildProject(root, {mode: 'development'})

    expect(summary.buildType).toBe('development')
    expect(readJson(buildSummaryPath(root, 'chrome')).buildType).toBe(
      'development'
    )
  })

  it('removes the development artifacts a dev compile left in dist', async () => {
    // A build that emits replaces the folder whole, so this compile is told
    // to emit nothing and the folder a dev session left is what stays.
    const devFiles = [
      'extension-js-control.json',
      'hot/main.abc123.hot-update.js',
      'content_scripts/dev-stub-0.js',
      'content_scripts/dev-css-1.js',
      'content_scripts/dev-registry.json'
    ]
    const kept = ['manifest.json', 'content_scripts/content-0.js']
    const root = project({
      config: EMIT_NOTHING,
      files: Object.fromEntries(
        [...devFiles, ...kept].map((file) => [`dist/chrome/${file}`, '{}'])
      )
    })
    const distPath = path.join(root, 'dist', 'chrome')

    await buildProject(root)

    for (const relative of devFiles) {
      expect(fs.existsSync(path.join(distPath, relative)), relative).toBe(false)
    }

    expect(fs.existsSync(path.join(distPath, 'hot'))).toBe(false)
    expect(filesUnder(distPath)).toEqual([...kept].sort())
  })

  it('names the dist it emitted into, in the summary and on disk', async () => {
    // Without this a host that shells out has to re-derive
    // `<project>/dist/<browser>` from the engine's own layout rules.
    const root = project()

    const summary = await buildProject(root)

    expect(summary.output_path).toBe(path.join(root, 'dist', 'chrome'))
    expect(readJson(buildSummaryPath(root, 'chrome')).output_path).toBe(
      path.join(root, 'dist', 'chrome')
    )

    expect(
      fs.existsSync(path.join(String(summary.output_path), 'manifest.json'))
    ).toBe(true)
  })

  it('prints the receipt against a re-pointed output.path, not dist/<browser>', async () => {
    // A user config that re-points output.path emits there, so a receipt
    // naming dist/<browser> reads as a failed build to whoever looks there.
    const root = project({
      config: `{
  config: (config) => ({
    ...config,
    output: {...config.output, path: require('node:path').join(__dirname, 'artifacts', 'web')}
  })
}`
    })
    const customOut = path.join(root, 'artifacts', 'web')

    const summary = await buildProject(root, {silent: false})

    const output = printed('log')
    const receipt = output
      .split('\n')
      .find((line) => line.includes('built for production in'))

    expect(receipt).toBeDefined()
    expect(receipt).toContain(customOut)
    expect(output).not.toContain(path.join(root, 'dist', 'chrome'))
    expect(summary.output_path).toBe(customOut)
    expect(fs.existsSync(path.join(customOut, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
  })

  it('folds the safari packager identity into the summary it returns', async () => {
    // A generated dev.extensionjs.* bundle id cannot be distributed, and the
    // summary is where a machine caller learns that its app carries one.
    const root = project()
    const identity = {
      appName: 'My App',
      bundleId: 'dev.extensionjs.My-App',
      bundleIdDerived: true,
      appPath: '/tmp/My App.app',
      macOsOnly: true
    }
    const safariPackager = vi.fn<SafariPackagerFn>(async () => identity)

    const summary = await buildProject(root, {
      browser: 'safari',
      safariPackager
    })

    expect(safariPackager).toHaveBeenCalledTimes(1)
    expect(safariPackager.mock.calls[0][0]).toBe(
      path.join(root, 'dist', 'safari')
    )

    expect(summary.safari).toEqual(identity)
    expect(readJson(buildSummaryPath(root, 'safari')).safari).toEqual(identity)
    expect(readJson(readyContractPath(root, 'safari')).extensionId).toBe(
      'dev.extensionjs.My-App.Extension'
    )
  })

  it('checks managed dependency conflicts against the package root when the manifest is in src', async () => {
    // The package.json that lists the loader and the config that names it
    // both sit one folder above the manifest. The import is never run.
    const root = writeExtensionProject(tempFolder('extjs-command-build-'), {
      manifestFile: 'src/manifest.json',
      manifest: {background: {service_worker: 'background.js'}},
      packageJson: {dependencies: {'sass-loader': '1.0.0'}},
      config: `{
  config: (config) => {
    const own = () => require('sass-loader')
    return config
  }
}`,
      files: {
        'src/background.js': 'console.log("started")\n',
        'node_modules/sass-loader/package.json': {
          name: 'sass-loader',
          version: '1.0.0'
        }
      }
    })

    const summary = await buildProject(root)

    expect(summary.warnings).toEqual([
      expect.stringMatching(
        /^W_MANAGED_DEP_CONFLICT: extension\.config\.js loads its own copy of sass-loader /
      )
    ])

    expect(printed('warn')).toContain(
      `PATH ${path.join(root, 'extension.config.js')}`
    )
  })

  // No real compile calls back without a result, so the compiler is replaced.
  it('rejects when compiler returns missing stats (prevents silent success)', async () => {
    const root = project()

    bundler.compiler = {
      run: (settled: (error: null, stats: undefined) => void) =>
        settled(null, undefined),
      close: (done: () => void) => done()
    }

    await expect(
      buildProject(root, {exitOnError: false})
    ).rejects.toMatchObject({
      code: 'E_COMPILE_FATAL',
      message: expect.stringMatching(/invalid stats output/i)
    })

    expect(fs.existsSync(path.join(root, 'dist'))).toBe(false)
  })

  describe('how a build fails', () => {
    // The text without the channel glyph and the severity word after it.
    const plain = (text: unknown) =>
      withoutColors(String(text)).replace(/^\S+ (?:(?:Warning|Error): )?/, '')

    const stagingFolders = (root: string) =>
      fs.existsSync(path.join(root, 'dist'))
        ? fs
            .readdirSync(path.join(root, 'dist'))
            .filter((name) => name.startsWith('.extension-build-'))
        : []

    it('starts the bundler outside any async scope and settles inside it', async () => {
      // The config file runs in this process, so its plugin reads the scope
      // through a global: once as the run starts, once as the result is read.
      const callerScope = new AsyncLocalStorage<string>()
      const seen: Record<string, string | undefined> = {}
      const probe = globalThis as {specBuildScope?: unknown}

      probe.specBuildScope = {callerScope, seen}

      const root = project({
        config: pluginConfig(
          `const {callerScope, seen} = globalThis.specBuildScope
        compiler.hooks.beforeRun.tap('spec-scope', () => {
          seen.ran = true
          seen.run = callerScope.getStore()
        })
        compiler.hooks.done.tap('spec-scope', (stats) => {
          const toJson = stats.toJson.bind(stats)
          stats.toJson = (...args) => {
            seen.settle = callerScope.getStore()
            return toJson(...args)
          }
        })`
        )
      })

      try {
        await callerScope.run('caller', () => buildProject(root))
      } finally {
        delete probe.specBuildScope
      }

      expect(seen).toEqual({ran: true, run: undefined, settle: 'caller'})
    })

    it('rejects and removes the staging folder when reading the result throws', async () => {
      // The compile wrote its staging folder, then the result cannot be read.
      const root = project({
        config: pluginConfig(
          `compiler.hooks.done.tap('spec-unreadable', (stats) => {
          fs.writeFileSync(
            path.join(__dirname, 'staged.json'),
            JSON.stringify(fs.readdirSync(path.join(__dirname, 'dist')))
          )
          stats.hasErrors = () => {
            throw new Error('stats exploded')
          }
        })`
        )
      })

      await expect(buildProject(root)).rejects.toThrow('stats exploded')

      const staged = (
        readJson(path.join(root, 'staged.json')) as string[]
      ).filter((name) => name.startsWith('.extension-build-chrome-'))

      expect(staged).toHaveLength(1)
      expect(stagingFolders(root)).toEqual([])
      expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
    })

    it('closes the compiler after a green build and after a failed one', async () => {
      const root = project({
        config: pluginConfig(
          `compiler.hooks.shutdown.tap('spec-closed', () => {
          fs.appendFileSync(path.join(__dirname, 'closed.log'), 'closed\\n')
        })
        compiler.hooks.beforeRun.tapPromise('spec-explode', async () => {
          if (fs.existsSync(path.join(__dirname, 'explode'))) {
            throw new Error('bundler exploded')
          }
        })`
        )
      })
      const closes = () =>
        fs
          .readFileSync(path.join(root, 'closed.log'), 'utf8')
          .trim()
          .split('\n')

      await buildProject(root)

      expect(closes()).toHaveLength(1)

      fs.writeFileSync(path.join(root, 'explode'), '')

      await expect(buildProject(root)).rejects.toThrow('bundler exploded')

      expect(closes()).toHaveLength(2)
    })

    it('never ends the process, even when the caller asks for exitOnError', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(((_code?: number) => undefined) as never)
      const broken = project({files: {'background.js': 'const = ;\n'}})

      const compileFailure = await failureOf(
        buildProject(broken, {exitOnError: true})
      )

      expect(compileFailure.message).toBe('Build failed with errors')
      expect(compileFailure.code).toBe('E_COMPILE')

      vi.mocked(
        ensureArtifactsMod.ensureDevelopArtifacts
      ).mockRejectedValueOnce(new Error('boom'))

      await expect(
        buildProject(project(), {exitOnError: true})
      ).rejects.toThrow('boom')

      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('fails the same way with exitOnError on, off and absent', async () => {
      const root = project({config: BUNDLER_EXPLODES})
      const outcomes: unknown[] = []

      for (const exitOnError of [true, false, undefined]) {
        vi.mocked(console.error).mockClear()

        const failure = await failureOf(
          buildProject(root, exitOnError === undefined ? {} : {exitOnError})
        )

        outcomes.push({
          code: failure.code,
          message: failure.message,
          printed: printed('error')
        })
      }

      expect(outcomes[0]).toEqual({
        code: 'E_COMPILE_FATAL',
        message: 'bundler exploded',
        printed: expect.stringContaining('Build failed with 1 error.')
      })

      expect(outcomes[1]).toEqual(outcomes[0])
      expect(outcomes[2]).toEqual(outcomes[0])
    })

    it('fails on a missing archive before the summary or the closer call it built', async () => {
      // A file sits where the archive folder would be made.
      const root = project({files: {blocked: 'not a folder\n'}})
      const zipPath = path.join(
        root,
        'blocked',
        'specextension-1.0.0-chrome.zip'
      )
      const reason = `EEXIST: file already exists, mkdir '${path.join(root, 'blocked')}'`

      const failure = await failureOf(
        buildProject(root, {silent: false, zip: true, zipDir: 'blocked'})
      )

      expect(failure.code).toBe('E_ZIP_SKIPPED')
      expect(plain(failure.message)).toBe(
        'The distribution zip was requested and not created.\n' +
          `PATH ${zipPath}\n` +
          reason
      )

      expect(printed('log')).not.toContain('built for production in')

      const errors = printed('error')

      expect(errors.split('was requested and not created').length).toBe(2)
      expect(errors).toContain('Build failed with 1 error.')

      const persisted = readJson(buildSummaryPath(root, 'chrome'))

      expect(persisted.errors_count).toBe(1)
      expect(persisted.errors).toEqual([
        `E_ZIP_SKIPPED: The distribution zip was requested and not created at ${zipPath}: ${reason}`
      ])

      expect(readJson(readyContractPath(root, 'chrome')).status).toBe('error')
    })

    it('prints a bundler error once, with no stack, under the fatal compile code', async () => {
      const root = project({config: BUNDLER_EXPLODES})

      const failure = await failureOf(buildProject(root))

      expect(failure.code).toBe('E_COMPILE_FATAL')
      expect(failure.message).toBe('bundler exploded')
      expect((failure.cause as Error).message).toBe('bundler exploded')

      const errors = printed('error')

      expect(errors.split('bundler exploded').length).toBe(2)
      expect(errors).not.toMatch(/\n\s+at /)
      expect(errors).toContain('Build failed with 1 error.')
    })

    // The compile locks the folder its output is renamed inside of.
    it.skipIf(process.platform === 'win32')(
      'codes a finished build that cannot take its place',
      async () => {
        const root = project({
          config: pluginConfig(
            `compiler.hooks.done.tap('spec-lock', () => {
          fs.chmodSync(path.join(__dirname, 'dist'), 0o555)
        })`
          )
        })

        try {
          const failure = await failureOf(buildProject(root))
          const lines = plain(failure.message).split('\n')

          expect(failure.code).toBe('E_DESTINATION_NOT_WRITABLE')
          expect(lines[0]).toBe("Couldn't move the finished build into place.")
          expect(lines[1]).toBe(`PATH ${path.join(root, 'dist', 'chrome')}`)
          expect(lines[2]).toContain('EACCES')
          expect(lines[3]).toBe(
            'Close whatever holds that folder open, check that it is writable, then run the build again.'
          )

          expect(fs.existsSync(path.join(root, 'dist', 'chrome'))).toBe(false)
        } finally {
          fs.chmodSync(path.join(root, 'dist'), 0o755)
        }
      }
    )

    it('codes a Safari build that emitted nothing to package', async () => {
      const root = project({config: EMIT_NOTHING})
      const safariPackager = vi.fn<SafariPackagerFn>(async () => undefined)

      const failure = await failureOf(
        buildProject(root, {browser: 'safari', safariPackager})
      )

      expect(failure.code).toBe('E_PREVIEW_NO_DIST')
      expect(plain(failure.message).split('\n').slice(0, 2)).toEqual([
        'No build output to package for Safari.',
        `NOT FOUND ${path.join(root, 'dist', 'safari')}`
      ])

      expect(safariPackager).not.toHaveBeenCalled()
    })

    it('codes a bad out dir, a bad zip dir and a bad config browser as usage errors', async () => {
      const root = project()
      const codeOf = async (at: string, options: Record<string, unknown>) =>
        (
          await buildProject(at, options).then(
            () => ({code: 'resolved'}),
            (error: BuildFailure) => error
          )
        ).code

      expect(await codeOf(root, {outDir: '.'})).toBe('E_INVALID_OPTION')
      expect(await codeOf(root, {outDir: '  '})).toBe('E_INVALID_OPTION')
      expect(await codeOf(root, {zipDir: '../escape'})).toBe('E_INVALID_OPTION')
      expect(await codeOf(root, {zipDir: 'dist/chrome/z'})).toBe(
        'E_INVALID_OPTION'
      )

      // Not one of them got as far as a compile.
      expect(fs.existsSync(path.join(root, 'dist'))).toBe(false)

      const misnamed = project({
        config: "{commands: {build: {browser: 'nope'}}}"
      })

      expect(await codeOf(misnamed, {browser: undefined})).toBe(
        'E_UNSUPPORTED_BROWSER'
      )
    })

    it('builds for chromium when no browser is named, and refuses a name it does not know', async () => {
      const root = project()

      const summary = await extensionBuild(root, {
        silent: true,
        install: false
      } as BuildOptions)

      expect(summary.browser).toBe('chromium')
      expect(
        fs.existsSync(path.join(root, 'dist', 'chromium', 'manifest.json'))
      ).toBe(true)

      // A binary with no name still picks its own family.
      const forked = await extensionBuild(root, {
        silent: true,
        install: false,
        chromiumBinary: '/opt/fork/browser'
      } as BuildOptions)

      expect(forked.browser).toBe('chromium-based')

      const untouched = project()
      const failure = await failureOf(
        buildProject(untouched, {browser: 'chorme'})
      )

      expect(failure.code).toBe('E_UNSUPPORTED_BROWSER')
      expect(failure.message).toBe(
        'Unsupported browser: chorme. Choose one of: chrome, edge, chromium, brave, opera, vivaldi, yandex, chromium-based, firefox, waterfox, librewolf, zen, floorp, gecko-based, firefox-based, safari, webkit-based, chromium-emulator.'
      )

      expect(fs.existsSync(path.join(untouched, 'dist'))).toBe(false)
      expect(printed('error')).toContain('Build failed with 1 error.')
    })

    it('reports a project it cannot find like every other build failure', async () => {
      const nowhere = fs.realpathSync(tempFolder('extjs-command-build-'))

      const failure = await failureOf(buildProject(nowhere))

      expect(failure.code).toBe('E_MANIFEST_NOT_FOUND')
      expect(plain(failure.message).split('\n').slice(0, 2)).toEqual([
        'Manifest file not found.',
        `NOT FOUND ${path.join(nowhere, 'manifest.json')}`
      ])

      const errors = printed('error')

      expect(errors).toContain('Manifest file not found.')
      expect(errors).toContain('Build failed with 1 error.')
    })

    it('leaves a project it cannot find to the frame under machine output', async () => {
      const nowhere = fs.realpathSync(tempFolder('extjs-command-build-'))

      vi.stubEnv('EXTENSION_OUTPUT', 'json')

      await expect(buildProject(nowhere)).rejects.toMatchObject({
        code: 'E_MANIFEST_NOT_FOUND'
      })

      expect(printed('error')).toBe('')

      // Past the project lookup a failure keeps its lines on stderr.
      vi.mocked(
        ensureArtifactsMod.ensureDevelopArtifacts
      ).mockRejectedValueOnce(new Error('boom'))

      await expect(buildProject(project())).rejects.toThrow('boom')

      expect(printed('error')).toContain('boom')
      expect(printed('error')).toContain('Build failed with 1 error.')
    })
  })
})
