import {describe, expect, it, vi} from 'vitest'
import {ConfigResolvedPlugin} from '../config-resolved-plugin'

function stubCompiler() {
  const taps: Record<string, Array<() => Promise<void>>> = {
    beforeRun: [],
    watchRun: []
  }
  const compiler = {
    options: {
      entry: {'action/index': {import: ['/p/popup.js']}},
      plugins: ['keep'],
      module: {rules: [{test: /\.ts$/}]},
      resolve: {extensions: ['.ts']}
    },
    hooks: {
      beforeRun: {
        tapPromise: (_n: string, fn: () => Promise<void>) =>
          taps.beforeRun.push(fn)
      },
      watchRun: {
        tapPromise: (_n: string, fn: () => Promise<void>) =>
          taps.watchRun.push(fn)
      }
    }
  }

  return {compiler, taps}
}

describe('ConfigResolvedPlugin', () => {
  it('hands the hook the final options and folds the answer back', async () => {
    const {compiler, taps} = stubCompiler()
    const hook = vi.fn((config: any) => ({
      ...config,
      module: {rules: [...config.module.rules, {test: /\.graphql$/}]},
      resolve: {extensions: ['.ts', '.graphql']}
    }))

    new ConfigResolvedPlugin(hook as never).apply(compiler as never)
    expect(taps.beforeRun).toHaveLength(1)
    expect(taps.watchRun).toHaveLength(1)

    await taps.beforeRun[0]()

    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook.mock.calls[0][0]).toBe(compiler.options)
    expect(compiler.options.module.rules).toHaveLength(2)
    expect(compiler.options.resolve.extensions).toEqual(['.ts', '.graphql'])
  })

  it('ignores entry and plugins, which the bundler fixed at construction', async () => {
    const {compiler, taps} = stubCompiler()
    new ConfigResolvedPlugin(((config: any) => ({
      ...config,
      entry: {'x/y': {import: ['/p/y.js']}},
      plugins: []
    })) as never).apply(compiler as never)

    await taps.beforeRun[0]()

    expect(compiler.options.entry).toEqual({
      'action/index': {import: ['/p/popup.js']}
    })

    expect(compiler.options.plugins).toEqual(['keep'])
  })

  it('runs once across beforeRun and watchRun and accepts a hook that returns nothing', async () => {
    const {compiler, taps} = stubCompiler()
    const hook = vi.fn((config: any) => {
      config.module.rules.push({test: /\.svg$/})
    })
    new ConfigResolvedPlugin(hook as never).apply(compiler as never)

    await taps.watchRun[0]()
    await taps.watchRun[0]()
    await taps.beforeRun[0]()

    expect(hook).toHaveBeenCalledTimes(1)
    expect(compiler.options.module.rules).toHaveLength(2)
  })
})
