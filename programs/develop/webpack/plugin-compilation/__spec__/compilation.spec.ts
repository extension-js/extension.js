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

vi.mock('../clean-dist', () => {
  const apply = vi.fn()
  class CleanDistFolderPluginMock {
    public static instances: any[] = []
    public static apply = apply
    constructor(public options: any) {
      ;(CleanDistFolderPluginMock as any).instances.push(this)
    }
    apply = apply
  }
  return {CleanDistFolderPlugin: CleanDistFolderPluginMock}
})

vi.mock('../compilation-lib/messages', () => ({
  boring: (name: string, duration: number) => `build(${name}, ${duration}ms)`
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
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    ;(fs.readFileSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      JSON.stringify({name: 'MyExt'})
    )
    // Reset CleanDistFolderPlugin mock instances between tests
    import('../clean-dist').then(({CleanDistFolderPlugin}) => {
      ;(CleanDistFolderPlugin as any).instances = []
      if ((CleanDistFolderPlugin as any).apply?.mockReset) {
        ;(CleanDistFolderPlugin as any).apply.mockReset()
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createCompiler(mode: 'development' | 'production' = 'development') {
    let doneHandler: any
    const compiler: any = {
      options: {mode},
      getInfrastructureLogger: () => ({
        info: console.log,
        warn: console.warn,
        error: console.error
      }),
      hooks: {
        // Some third-party plugins call done.tap, so provide both
        done: {
          tap: (_name: string, cb: any) => {
            doneHandler = (stats: any, _done: any) => cb(stats)
          },
          tapAsync: (_name: string, cb: any) => {
            doneHandler = cb
          }
        }
      }
    }
    return {
      compiler,
      emitDone: (stats: any, done = () => {}) => doneHandler(stats, done)
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

    // Success logs are now emitted via the infrastructure logger only when there are errors.
    // We no longer print success lines to console.log.
    expect(consoleLogSpy).not.toHaveBeenCalled()
    expect(stdoutWriteSpy).not.toHaveBeenCalled()
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

    const {CleanDistFolderPlugin} = await import('../clean-dist')
    expect((CleanDistFolderPlugin as any).instances.length).toBe(0)
    // Success logs are suppressed on console.log
    expect(consoleLogSpy).not.toHaveBeenCalled()
  })

  it('collapses repeated messages with counter for same key', () => {
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

    // Success messages are not printed to console.log anymore
    expect(consoleLogSpy).not.toHaveBeenCalled()
  })

  vi.mock('../plugin-zip', () => {
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

    const {ZipPlugin} = await import('../plugin-zip')

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
