import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
const FS = vi.hoisted(() => ({
  readFileSync: vi.fn()
}))
vi.mock('fs', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    ...FS
  }
})
import * as fs from 'fs'
vi.mock('case-sensitive-paths-webpack-plugin', () => ({
  default: class {
    apply() {}
  }
}))

import {CompilationPlugin} from '../index'
vi.mock('@rspack/core', async (importOriginal) => {
  const actual: any = await importOriginal()
  class FakeDefinePlugin {
    constructor(_defs: any) {}
    apply(_compiler: any) {}
  }
  return {
    ...actual,
    DefinePlugin: FakeDefinePlugin
  }
})
vi.mock('../clean-dist', () => {
  class CleanDistFolderPlugin {
    apply() {}
  }
  return {CleanDistFolderPlugin}
})

describe('CompilationPlugin', () => {
  const originalIsTTY = process.stdout.isTTY

  beforeEach(() => {
    vi.restoreAllMocks()
    ;(fs.readFileSync as any).mockImplementation(() =>
      JSON.stringify({name: 'My Extension'})
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    ;(process.stdout as any).isTTY = originalIsTTY
  })

  it('hooks into compiler and prints a summary line on done', () => {
    const plugin = new CompilationPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'chrome',
      clean: false
    } as any)

    const doneCalls: number[] = []
    const tapCallbacks: Array<(stats: any, done: () => void) => void> = []
    const compiler: any = {
      options: {mode: 'development'},
      hooks: {
        done: {
          tapAsync: (_: string, cb: any) => tapCallbacks.push(cb)
        },
        thisCompilation: {tap: () => {}}
      }
    }

    plugin.apply(compiler)

    const fakeStats = {
      hasErrors: () => false,
      compilation: {
        startTime: Date.now(),
        endTime: Date.now() + 5,
        name: 'should-be-undefined-after'
      }
    }

    vi.spyOn(console, 'log').mockImplementation(() => {})

    // trigger done hook
    tapCallbacks[0](fakeStats, () => doneCalls.push(1))

    expect(doneCalls.length).toBe(1)
    expect(fakeStats.compilation.name).toBeUndefined()
    expect(console.log).toHaveBeenCalled()
  })

  it('respects clean=false and does not invoke CleanDistFolderPlugin', async () => {
    const plugin = new CompilationPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'chrome',
      clean: false
    } as any)

    const applied: string[] = []
    const compiler: any = {
      options: {mode: 'development'},
      hooks: {
        done: {tapAsync: () => {}},
        thisCompilation: {tap: () => {}}
      }
    }

    // Spy on CleanDistFolderPlugin.apply by monkey-patching constructor prototype
    // Use the mocked CleanDistFolderPlugin
    const {CleanDistFolderPlugin} = await import('../clean-dist')
    const applySpy = vi.spyOn(CleanDistFolderPlugin.prototype, 'apply')

    plugin.apply(compiler)

    expect(applySpy).not.toHaveBeenCalled()
    applySpy.mockRestore()
  })

  it('defaults clean to true and invokes CleanDistFolderPlugin', async () => {
    const plugin = new CompilationPlugin({
      manifestPath: '/abs/path/manifest.json',
      browser: 'chrome'
    } as any)

    const compiler: any = {
      options: {mode: 'development'},
      hooks: {
        done: {tapAsync: () => {}},
        thisCompilation: {tap: () => {}}
      }
    }

    const {CleanDistFolderPlugin} = await import('../clean-dist')
    const applySpy = vi.spyOn(CleanDistFolderPlugin.prototype, 'apply')

    plugin.apply(compiler)

    expect(applySpy).toHaveBeenCalled()
    applySpy.mockRestore()
  })
})
