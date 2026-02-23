import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => true),
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
  })
})
