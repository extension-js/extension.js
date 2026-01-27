import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => true)
}))

// Ensure svelte-loader and typescript resolve
const originalResolve = (require as any).resolve
beforeEach(() => {
  ;(require as any).resolve = vi.fn((id: string) =>
    id === 'svelte-loader' || id === 'typescript'
      ? `/mock/${id}`
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
    const integrations =
      (await import('../../frameworks-lib/integrations')) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'svelte'
    )

    // Provide custom loader options via loader-options helper
    vi.doMock('../../js-frameworks-lib/load-loader-options', () => ({
      loadLoaderOptions: vi.fn(async () => ({bar: 2}))
    }))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingSvelte, maybeUseSvelte} =
      await import('../../js-tools/svelte')

    expect(isUsingSvelte('/p')).toBe(true)
    expect(isUsingSvelte('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)

    const result = await maybeUseSvelte('/p', 'development')
    expect(result?.loaders?.length).toBeGreaterThanOrEqual(3)
    const svelteRule = result?.loaders?.find((r: any) =>
      String(r.test).includes('svelte\\.js')
    )
    expect(svelteRule?.use?.options?.bar).toBe(2)

    // Apply resolver plugin to a fake compiler to verify additions
    const compiler: any = {
      options: {resolve: {mainFields: [], conditionNames: [], extensions: []}}
    }
    result?.plugins?.forEach((pl: any) => pl.apply(compiler))
    expect(compiler.options.resolve.mainFields[0]).toBe('svelte')
    expect(compiler.options.resolve.extensions).toContain('.svelte')
    expect(compiler.options.resolve.conditionNames).toContain('svelte')
  })
})
