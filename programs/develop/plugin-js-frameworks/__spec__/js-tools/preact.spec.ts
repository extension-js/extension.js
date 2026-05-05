import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
}))

// Ensure @rspack/plugin-preact-refresh resolves
const originalResolve = (require as any).resolve
beforeEach(() => {
  ;(require as any).resolve = vi.fn((id: string) =>
    id === '@rspack/plugin-preact-refresh'
      ? '/mock/prefresh'
      : originalResolve(id)
  )
})
afterEach(() => {
  ;(require as any).resolve = originalResolve
})

describe('preact tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingPreact logs once when dependency present; maybeUsePreact returns aliases and plugin', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'preact'
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const PreactRefreshPluginMock = function (this: any) {
      this.apply = vi.fn()
    } as any
    vi.doMock('module', () => ({
      createRequire: () => {
        const req = ((id: string) => {
          if (id === '@rspack/plugin-preact-refresh') {
            return {default: PreactRefreshPluginMock}
          }
          throw new Error(`Cannot find module ${id}`)
        }) as any
        req.resolve = (id: string) => `/project/node_modules/${id}`
        return req
      }
    }))

    const {isUsingPreact, maybeUsePreact} = await import(
      '../../js-tools/preact'
    )

    expect(isUsingPreact('/p')).toBe(true)
    expect(isUsingPreact('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)

    const result = await maybeUsePreact('/p')
    expect(result?.plugins?.length).toBeGreaterThan(0)
    expect(result?.alias?.react).toContain(
      '/project/node_modules/preact/compat'
    )
    expect(result?.alias?.['react-dom']).toContain(
      '/project/node_modules/preact/compat'
    )
    expect(result?.alias?.['react-dom/test-utils']).toContain(
      '/project/node_modules/preact/test-utils'
    )
    expect(result?.alias?.['react/jsx-runtime']).toContain(
      '/project/node_modules/preact/jsx-runtime'
    )
    expect(result?.alias?.['react/jsx-dev-runtime']).toContain(
      '/project/node_modules/preact/jsx-dev-runtime'
    )
    // Regression: @rspack/plugin-preact-refresh sets
    // `compiler.options.resolve.alias.preact = options.preactPath` at apply-
    // time. If we pass `{}` here pnpm strict layouts wedge the dev server
    // because `preact: undefined` short-circuits webpack's alias and the
    // plugin's pnpm dir doesn't sibling-link preact for Node fallback. The
    // alias resolves to the *package directory* (parent of package.json) so
    // webpack treats it as a prefix for sub-paths like `preact/hooks`.
    expect(result?.alias?.preact).toBe('/project/node_modules/preact')
  })

  it('passes preactPath to PreactRefreshPlugin so it can alias preact in pnpm strict layouts', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'preact'
    )

    let pluginOptions: unknown
    const PreactRefreshPluginMock = function (this: any, options: unknown) {
      pluginOptions = options
      this.apply = vi.fn()
    } as any
    vi.doMock('module', () => ({
      createRequire: () => {
        const req = ((id: string) => {
          if (id === '@rspack/plugin-preact-refresh') {
            return {default: PreactRefreshPluginMock}
          }
          throw new Error(`Cannot find module ${id}`)
        }) as any
        req.resolve = (id: string) => `/project/node_modules/${id}`
        return req
      }
    }))

    const {maybeUsePreact} = await import('../../js-tools/preact')
    await maybeUsePreact('/p')

    expect(pluginOptions).toEqual({
      preactPath: '/project/node_modules/preact'
    })
  })
})
