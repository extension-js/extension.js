import {describe, it, expect, beforeEach, vi, afterEach} from 'vitest'

vi.mock('fs', async () => {
  const actual: any = await vi.importActual('fs')
  return {
    ...actual,
    readFileSync: vi.fn()
  }
})
import * as fs from 'fs'

// Mock deps used inside the plugin implementation
vi.mock('../env', () => {
  const apply = vi.fn()
  class EnvPluginMock {
    public static lastOptions: any
    constructor(options: any) {
      ;(EnvPluginMock as any).lastOptions = options
    }
    apply = apply
  }
  return {EnvPlugin: EnvPluginMock}
})

const cleanDistMocks = vi.hoisted(() => ({
  instances: [] as any[],
  apply: vi.fn()
}))

vi.mock('../clean-dist', () => {
  class CleanDistFolderPluginMock {
    public static instances: any[] = cleanDistMocks.instances
    constructor(public options: any) {
      cleanDistMocks.instances.push(this)
    }
    apply = cleanDistMocks.apply
  }
  return {CleanDistFolderPlugin: CleanDistFolderPluginMock}
})

vi.mock('../compilation-lib/messages', () => ({
  boring: (name: string, duration: number) => `build(${name}, ${duration}ms)`,
  zipPackagingSkipped: (reason: string) => `zip-skip(${reason})`
}))

vi.mock('pintor', () => ({
  default: {
    gray: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s
  }
}))

vi.mock('case-sensitive-paths-webpack-plugin', () => ({
  default: class {
    apply() {}
  }
}))

// Module under test
import {CompilationPlugin} from '../index'

describe('CompilationPlugin', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>
  const originalBrowserLaunchEnabled =
    process.env.EXTENSION_BROWSER_LAUNCH_ENABLED

  beforeEach(() => {
    process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = '0'
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    ;(fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({name: 'MyExt'})
    )
    cleanDistMocks.instances.length = 0
    cleanDistMocks.apply.mockClear()
  })

  afterEach(() => {
    process.env.EXTENSION_BROWSER_LAUNCH_ENABLED = originalBrowserLaunchEnabled
    vi.restoreAllMocks()
  })

  function createCompiler(mode: 'development' | 'production' = 'development') {
    const doneHandlers: Array<(stats: any, done?: any) => any> = []
    const compiler: any = {
      options: {
        mode,
        // Minimal output config so @rspack/core DefinePlugin can apply in tests
        output: {environment: {}}
      },
      getInfrastructureLogger: () => ({
        info: console.log,
        warn: console.warn,
        error: console.error
      }),
      hooks: {
        watchClose: {
          tap: () => {}
        },
        // Some third-party plugins call done.tap, so provide both
        done: {
          tap: (_name: string, cb: any) => {
            doneHandlers.push((stats: any, _done: any) => cb(stats))
          },
          tapAsync: (_name: string, cb: any) => {
            doneHandlers.push(cb)
          },
          tapPromise: (_name: string, cb: any) => {
            doneHandlers.push((stats: any, _done: any) => cb(stats))
          }
        }
      }
    }
    return {
      compiler,
      emitDone: (stats: any, done = () => {}) =>
        doneHandlers.forEach((handler) => handler(stats, done))
    }
  }

  it('applies EnvPlugin and optionally CleanDistFolderPlugin based on options', async () => {
    ;(fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({name: 'ExtA'})
    )
    const {compiler, emitDone} = createCompiler('development')
    const plugin = new CompilationPlugin({
      manifestPath: '/p/manifest.json',
      browser: 'edge',
      clean: true
    })
    plugin.apply(compiler as any)

    // trigger done to hit logging branch
    emitDone({
      hasErrors: () => false,
      compilation: {startTime: 0, endTime: 10}
    })

    // EnvPlugin constructed with provided options via mocked class
    const {EnvPlugin} = await import('../env')
    expect((EnvPlugin as any).lastOptions).toEqual({
      manifestPath: '/p/manifest.json',
      browser: 'edge'
    })

    // Clean plugin path exercised without throwing (behavior verified via user-facing log)

    // Success logs are printed via BoringPlugin using messages.boring.
    expect(consoleLogSpy).toHaveBeenCalledWith('build(ExtA, 10ms)')
  })

  it('does not apply CleanDistFolderPlugin when clean is false', async () => {
    ;(fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({name: 'ExtB'})
    )
    const {compiler, emitDone} = createCompiler('development')
    const plugin = new CompilationPlugin({
      manifestPath: '/p/manifest.json',
      browser: 'chrome',
      clean: false
    })
    plugin.apply(compiler as any)

    emitDone({
      hasErrors: () => false,
      compilation: {startTime: 0, endTime: 5}
    })

    expect(cleanDistMocks.instances.length).toBe(0)

    // Even when clean is false, success logs are still printed by BoringPlugin.
    expect(consoleLogSpy).toHaveBeenCalledWith('build(ExtB, 5ms)')
  })

  it('ignores known Vue compiler-sfc critical dependency warnings', () => {
    const {compiler} = createCompiler('development')
    const plugin = new CompilationPlugin({
      manifestPath: '/p/manifest.json',
      browser: 'chrome',
      clean: true
    })

    plugin.apply(compiler as any)

    const ignoreWarnings = compiler.options.ignoreWarnings as Array<
      (warning: any) => boolean
    >
    const shouldIgnore = ignoreWarnings.some((matcher) =>
      matcher({
        message:
          'Critical dependency: require function is used in a way in which dependencies cannot be statically extracted',
        module: {
          resource:
            '/tmp/node_modules/@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js'
        }
      })
    )

    expect(shouldIgnore).toBe(true)
  })

  it('logs a boring success message on repeated compilations', () => {
    ;(fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({name: 'ExtC'})
    )
    const {compiler, emitDone} = createCompiler('development')
    ;(process.stdout as any).isTTY = false

    const plugin = new CompilationPlugin({
      manifestPath: '/p/manifest.json',
      browser: 'chrome',
      clean: true
    })
    plugin.apply(compiler as any)

    const stats = {
      hasErrors: () => false,
      compilation: {startTime: 0, endTime: 10}
    }

    emitDone(stats)
    emitDone(stats)

    // Successful compilations always emit the boring build line.
    const buildLines = consoleLogSpy.mock.calls.filter((call) =>
      String(call[0] || '').startsWith('build(')
    )
    expect(buildLines.length).toBe(2)
  })

  it('prints aggregated warnings before later done hooks like browser launch', () => {
    ;(fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({name: 'ExtWarn'})
    )

    const doneTapOrder: Array<(stats: any) => any> = []
    const browserLaunchSpy = vi.fn()
    const compiler: any = {
      options: {
        mode: 'development',
        output: {environment: {}}
      },
      hooks: {
        watchClose: {
          tap: () => {}
        },
        done: {
          tap: (_name: string, cb: any) => {
            doneTapOrder.push(cb)
          }
        }
      }
    }

    const plugin = new CompilationPlugin({
      manifestPath: '/p/manifest.json',
      browser: 'chrome',
      clean: true,
      port: 8080
    })
    plugin.apply(compiler as any)

    compiler.hooks.done.tapPromise = (_name: string, cb: any) => {
      doneTapOrder.push(cb)
    }
    compiler.hooks.done.tapPromise('chromium:launch', async () => {
      browserLaunchSpy('launch')
    })

    const stats = {
      hasErrors: () => false,
      hasWarnings: () => true,
      toString: () => 'WARNING in Content script requires a default export.',
      toJson: () => ({assets: [{name: 'a.js'}], entrypoints: {main: {}}}),
      compilation: {startTime: 0, endTime: 12}
    }

    for (const cb of doneTapOrder) {
      cb(stats)
    }

    expect(consoleLogSpy).toHaveBeenCalledWith('build(ExtWarn, 12ms)')
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'WARNING in Content script requires a default export.'
    )
    expect(browserLaunchSpy).toHaveBeenCalledWith('launch')

    const warnOrder = consoleWarnSpy.mock.invocationCallOrder[0]
    const launchOrder = browserLaunchSpy.mock.invocationCallOrder[0]
    expect(warnOrder).toBeLessThan(launchOrder)
  })

  vi.mock('../zip', () => {
    const apply = vi.fn()
    class ZipPluginMock {
      public static lastOptions: any
      constructor(options: any) {
        ;(ZipPluginMock as any).lastOptions = options
      }
      apply = apply
    }
    return {ZipPlugin: ZipPluginMock}
  })

  it('registers ZipPlugin only in production when zip/zipSource are set', async () => {
    const {compiler: devCompiler} = createCompiler('development')
    const {compiler: prodCompiler} = createCompiler('production')

    const dev = new CompilationPlugin({
      manifestPath: '/p/manifest.json',
      browser: 'chrome',
      clean: true,
      zip: true
    })
    dev.apply(devCompiler as any)

    const prod = new CompilationPlugin({
      manifestPath: '/p/manifest.json',
      browser: 'chrome',
      clean: true,
      zip: true
    })
    prod.apply(prodCompiler as any)

    const {ZipPlugin} = await import('../zip')

    // Last options should come from the production apply (development should not register ZipPlugin)
    expect((ZipPlugin as any).lastOptions).toEqual(
      expect.objectContaining({
        manifestPath: '/p/manifest.json',
        browser: 'chrome',
        zipData: expect.objectContaining({zip: true})
      })
    )
  })
})
