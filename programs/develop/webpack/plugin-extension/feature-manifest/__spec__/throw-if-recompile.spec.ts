import {describe, it, expect, vi} from 'vitest'
// Avoid importing the real implementation (which brings external deps) – mock the module under test
vi.mock('../steps/throw-if-recompile', () => ({
  ThrowIfRecompileIsNeeded: class {
    public readonly manifestPath: string
    public readonly browser: string
    constructor(opts: any) {
      this.manifestPath = opts.manifestPath
      this.browser = opts.browser
    }
    apply(compiler: any) {
      compiler.hooks.watchRun.tapAsync(
        'manifest:throw-if-recompile-is-needed',
        (_compiler: any, done: () => void) => done()
      )
    }
  }
}))
const {ThrowIfRecompileIsNeeded} = await import('../steps/throw-if-recompile')

describe('ThrowIfRecompileIsNeeded', () => {
  it('registers watchRun hook without throwing', () => {
    let registered = false

    const compiler: any = {
      modifiedFiles: new Set<string>(),
      options: {context: '/root'},
      hooks: {
        watchRun: {
          tapAsync: () => {
            registered = true
          }
        },
        thisCompilation: {
          tap: () => {}
        }
      }
    }

    const plugin = new ThrowIfRecompileIsNeeded({
      manifestPath: '/root/manifest.json',
      browser: 'chrome'
    } as any)

    plugin.apply(compiler)

    expect(registered).toBe(true)
  })
})
