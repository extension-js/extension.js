import {describe, expect, it, vi} from 'vitest'
import {ConfigResolvedPlugin} from '../config-resolved-plugin'

function stubCompiler() {
  const taps: Record<string, Array<() => Promise<void>>> = {
    beforeRun: [],
    watchRun: []
  }
  const construction: Record<string, Array<() => void>> = {
    environment: [],
    afterPlugins: []
  }
  const minimizer = {apply: vi.fn()}
  const compiler = {
    options: {
      entry: {'action/index': {import: ['/p/popup.js']}},
      plugins: ['keep'],
      context: '/p',
      mode: 'production',
      devtool: false as unknown,
      target: ['web'] as unknown,
      externals: undefined as unknown,
      module: {rules: [{test: /\.ts$/}]},
      resolve: {extensions: ['.ts']},
      optimization: {
        minimize: true,
        minimizer: [minimizer],
        splitChunks: {
          chunks: 'all',
          cacheGroups: {} as Record<string, unknown>
        },
        runtimeChunk: false
      },
      output: {path: '/p/dist/chrome', filename: '[name].js', iife: true}
    },
    hooks: {
      environment: {
        tap: (_n: string, fn: () => void) => construction.environment.push(fn)
      },
      afterPlugins: {
        tap: (_n: string, fn: () => void) => construction.afterPlugins.push(fn)
      },
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

  // What the bundler does between the plugins and the first run: it applies
  // the minimizers only while `minimize` is on.
  const construct = () => {
    for (const fn of construction.environment) fn()

    const seen = compiler.options.optimization.minimize

    for (const fn of construction.afterPlugins) fn()

    return seen
  }

  return {compiler, taps, construct, minimizer}
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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new ConfigResolvedPlugin(((config: any) => ({
      ...config,
      entry: {'x/y': {import: ['/p/y.js']}},
      plugins: []
    })) as never).apply(compiler as never)

    await taps.beforeRun[0]()
    expect(String(warn.mock.calls[0][0])).toContain('entry, plugins')
    warn.mockRestore()

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

  it('holds the minimizers back so the hook can switch them off', async () => {
    const {compiler, taps, construct, minimizer} = stubCompiler()
    new ConfigResolvedPlugin(((config: any) => {
      config.optimization.minimize = false
    }) as never).apply(compiler as never)

    expect(construct()).toBe(false)
    expect(compiler.options.optimization.minimize).toBe(true)

    await taps.beforeRun[0]()

    expect(compiler.options.optimization.minimize).toBe(false)
    expect(minimizer.apply).not.toHaveBeenCalled()
  })

  it('applies the minimizers the hook leaves, once', async () => {
    const {compiler, taps, construct, minimizer} = stubCompiler()
    const added = {apply: vi.fn()}
    new ConfigResolvedPlugin(((config: any) => ({
      ...config,
      optimization: {
        ...config.optimization,
        minimizer: [...config.optimization.minimizer, added]
      }
    })) as never).apply(compiler as never)

    construct()
    await taps.watchRun[0]()
    await taps.beforeRun[0]()

    expect(minimizer.apply).toHaveBeenCalledTimes(1)
    expect(minimizer.apply).toHaveBeenCalledWith(compiler)
    expect(added.apply).toHaveBeenCalledTimes(1)
  })

  it('undoes a change to a fixed key and names it in one warning', async () => {
    const {compiler, taps, construct} = stubCompiler()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const splitChunks = compiler.options.optimization.splitChunks

    try {
      new ConfigResolvedPlugin(((config: any) => {
        config.plugins.push('late')
        config.mode = 'development'
        config.output.path = '/elsewhere'
        config.output.iife = false

        return {
          ...config,
          context: '/other',
          optimization: {...config.optimization, splitChunks: false}
        }
      }) as never).apply(compiler as never)

      construct()
      await taps.beforeRun[0]()

      expect(compiler.options.plugins).toEqual(['keep'])
      expect(compiler.options.mode).toBe('production')
      expect(compiler.options.context).toBe('/p')
      expect(compiler.options.optimization.splitChunks).toEqual(splitChunks)
      expect(compiler.options.output.path).toBe('/p/dist/chrome')
      expect(compiler.options.output.iife).toBe(false)

      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0][0])
      expect(line).not.toContain('\n')

      for (const key of [
        'plugins',
        'context',
        'mode',
        'optimization.splitChunks',
        'output.path'
      ]) {
        expect(line).toContain(key)
      }

      expect(line).not.toContain('entry')
      expect(line).not.toContain('output.iife')
      expect(line).not.toContain('minimize')
    } finally {
      warn.mockRestore()
    }
  })

  it('warns for every top-level key the bundler already consumed', async () => {
    const {compiler, taps, construct} = stubCompiler()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      new ConfigResolvedPlugin(((config: any) => {
        config.devtool = 'source-map'
        config.target = 'node'
        config.resolve.extensions.push('.mjs')

        return {...config, externals: {lodash: '_'}, notAnOption: true}
      }) as never).apply(compiler as never)

      construct()
      await taps.beforeRun[0]()

      expect(compiler.options.devtool).toBe(false)
      expect(compiler.options.target).toEqual(['web'])
      expect(compiler.options.externals).toBeUndefined()
      expect('notAnOption' in compiler.options).toBe(false)
      expect(compiler.options.resolve.extensions).toEqual(['.ts', '.mjs'])

      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain(
        'configResolved changed devtool, target, externals, notAnOption, which'
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('names an edit made in place deep inside a fixed key by its path', async () => {
    const {compiler, taps, construct} = stubCompiler()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      new ConfigResolvedPlugin(((config: any) => {
        config.optimization.splitChunks.cacheGroups.mine = {name: 'mine'}
        config.entry['action/index'].import.push('/p/extra.js')
      }) as never).apply(compiler as never)

      construct()
      await taps.beforeRun[0]()

      expect(compiler.options.optimization.splitChunks.cacheGroups).toEqual({})
      expect(compiler.options.entry['action/index'].import).toEqual([
        '/p/popup.js'
      ])

      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0][0])
      expect(line).toContain('entry.action/index.import')
      expect(line).toContain('optimization.splitChunks.cacheGroups.mine')
    } finally {
      warn.mockRestore()
    }
  })

  it('stays quiet for a hook that touches nothing fixed', async () => {
    const {compiler, taps, construct} = stubCompiler()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      // A merge helper hands back clones of what it left alone.
      new ConfigResolvedPlugin(((config: any) => ({
        ...config,
        entry: JSON.parse(JSON.stringify(config.entry)),
        plugins: [...config.plugins],
        optimization: {minimize: false},
        output: {...config.output, filename: '[name].bundle.js'}
      })) as never).apply(compiler as never)

      construct()
      await taps.beforeRun[0]()

      expect(warn).not.toHaveBeenCalled()
      expect(compiler.options.optimization.minimize).toBe(false)
      expect(compiler.options.optimization.runtimeChunk).toBe(false)
      expect(compiler.options.optimization.splitChunks).toEqual({
        chunks: 'all',
        cacheGroups: {}
      })

      expect(compiler.options.output.filename).toBe('[name].bundle.js')
    } finally {
      warn.mockRestore()
    }
  })
})
