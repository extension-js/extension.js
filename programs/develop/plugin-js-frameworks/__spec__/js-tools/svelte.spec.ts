import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {pathPattern} from '../../../lib/__spec__/platform-utils'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
}))

const originalResolve = (require as any).resolve
beforeEach(() => {
  ;(require as any).resolve = vi.fn((id: string) =>
    id === 'svelte-loader' || id === 'typescript'
      ? `/mock/${id}`
      : id.startsWith('svelte/')
        ? `/p/node_modules/${id}`
        : originalResolve(id)
  )
})

afterEach(() => {
  ;(require as any).resolve = originalResolve
})

describe('svelte tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingSvelte logs once; maybeUseSvelte returns loaders and resolver plugin', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'svelte'
    )

    vi.doMock('../../js-frameworks-lib/load-loader-options', async () => ({
      ...(await vi.importActual('../../js-frameworks-lib/load-loader-options')),
      loadLoaderOptions: vi.fn(async () => ({bar: 2}))
    }))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingSvelte, maybeUseSvelte} = await import(
      '../../js-tools/svelte'
    )

    expect(isUsingSvelte('/p')).toBe(true)
    expect(isUsingSvelte('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)

    const result = await maybeUseSvelte('/p', 'development')
    expect(result?.loaders?.length).toBeGreaterThanOrEqual(3)
    const svelteRule = result?.loaders?.find((r: any) =>
      String(r.test).includes('svelte\\.js')
    )
    expect(svelteRule?.use).toMatchObject({options: {bar: 2}})

    const compiler: any = {
      options: {
        resolve: {
          mainFields: [],
          conditionNames: ['browser', 'import', 'module', 'default'],
          extensions: []
        }
      }
    }
    result?.plugins?.forEach((pl: any) => {
      pl.apply(compiler)
    })

    expect(compiler.options.resolve.mainFields).toEqual([])
    expect(compiler.options.resolve.extensions).toContain('.svelte')
    expect(compiler.options.resolve.conditionNames).toEqual([
      'browser',
      'import',
      'module',
      'default'
    ])

    expect(String(result?.alias?.svelte)).toMatch(
      pathPattern(['svelte', 'src', 'index-client.js'])
    )

    expect(String(result?.alias?.['svelte/store'])).toMatch(
      pathPattern(['svelte', 'src', 'store', 'index-client.js'])
    )

    expect(String(result?.alias?.['svelte/reactivity'])).toMatch(
      pathPattern(['svelte', 'src', 'reactivity', 'index-client.js'])
    )

    expect(String(result?.alias?.['svelte/legacy'])).toMatch(
      pathPattern(['svelte', 'src', 'legacy', 'legacy-client.js'])
    )
  })

  it('gives .svelte, .svelte.js and .svelte.ts the same loader options', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'svelte'
    )

    vi.doMock('../../js-frameworks-lib/load-loader-options', async () => ({
      ...(await vi.importActual('../../js-frameworks-lib/load-loader-options')),
      loadLoaderOptions: vi.fn(async () => ({bar: 2}))
    }))

    vi.spyOn(console, 'log').mockImplementation(() => {})
    const {maybeUseSvelte} = await import('../../js-tools/svelte')
    const result = await maybeUseSvelte('/p', 'development')

    const svelteLoaderOptionsFor = (file: string) => {
      const rules = (result?.loaders || []).filter(
        (rule: any) => rule.test instanceof RegExp && rule.test.test(file)
      )
      expect(rules).toHaveLength(1)
      const entries = [rules[0].use].flat()
      const svelteEntries = entries.filter(
        (entry): entry is {loader?: string; options?: unknown} =>
          String((entry as {loader?: string})?.loader).includes('svelte-loader')
      )
      expect(svelteEntries).toHaveLength(1)

      return svelteEntries[0].options
    }

    const component = svelteLoaderOptionsFor('/p/Counter.svelte')
    const jsModule = svelteLoaderOptionsFor('/p/state.svelte.js')
    const tsModule = svelteLoaderOptionsFor('/p/state.svelte.ts')

    expect(component).toEqual({
      emitCss: true,
      compilerOptions: {dev: true},
      hotReload: true,
      bar: 2
    })

    expect(jsModule).toEqual(component)
    expect(tsModule).toEqual(component)

    const tsRule = (result?.loaders || []).find((rule: any) =>
      String(rule.test).includes('svelte\\.ts')
    ) as any
    const [, typeStrip] = tsRule.use
    expect(typeStrip.loader).toBe('builtin:swc-loader')
    expect(typeStrip.options.jsc.parser.syntax).toBe('typescript')
    expect(typeStrip.options.jsc.target).toBe('esnext')
  })

  it('compiles a component that ships inside node_modules', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'svelte'
    )

    vi.doMock('../../js-frameworks-lib/load-loader-options', async () => ({
      ...(await vi.importActual('../../js-frameworks-lib/load-loader-options')),
      loadLoaderOptions: vi.fn(async () => null)
    }))

    vi.spyOn(console, 'log').mockImplementation(() => {})
    const {maybeUseSvelte} = await import('../../js-tools/svelte')
    const result = await maybeUseSvelte('/p', 'development')

    const rulesFor = (file: string) =>
      (result?.loaders || []).filter(
        (rule: any) => rule.test instanceof RegExp && rule.test.test(file)
      ) as any[]

    const component = rulesFor('/p/node_modules/fancy-svelte-lib/Button.svelte')
    expect(component).toHaveLength(1)
    expect(component[0].exclude).toBeUndefined()

    const tsModule = rulesFor(
      '/p/node_modules/fancy-svelte-lib/state.svelte.ts'
    )
    expect(tsModule).toHaveLength(1)
    expect(tsModule[0].exclude).toBeUndefined()
  })

  it('keeps dev compilation on when the project sets its own compilerOptions', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'svelte'
    )

    vi.doMock('../../js-frameworks-lib/load-loader-options', async () => ({
      ...(await vi.importActual('../../js-frameworks-lib/load-loader-options')),
      loadLoaderOptions: vi.fn(async () => ({compilerOptions: {runes: true}}))
    }))

    vi.spyOn(console, 'log').mockImplementation(() => {})
    const {maybeUseSvelte} = await import('../../js-tools/svelte')
    const result = await maybeUseSvelte('/p', 'development')
    const rule = (result?.loaders || []).find((candidate: any) =>
      String(candidate.test).includes('svelte\\.js')
    ) as any

    expect(rule.use.options.compilerOptions).toEqual({dev: true, runes: true})
    expect(rule.use.options.hotReload).toBe(true)
    expect(rule.use.options.emitCss).toBe(true)
  })
})
