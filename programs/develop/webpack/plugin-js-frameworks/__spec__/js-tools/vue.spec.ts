import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => true),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
}))

// Ensure vue-loader resolves
const originalResolve = (require as any).resolve
beforeEach(() => {
  ;(require as any).resolve = vi.fn((id: string) =>
    id === 'vue-loader' ? '/mock/vue-loader' : originalResolve(id)
  )
})
afterEach(() => {
  ;(require as any).resolve = originalResolve
})

describe('vue tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingVue logs once; maybeUseVue returns default loader and plugin; merges custom options', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'vue'
    )

    // Provide custom loader options via loader-options helper
    vi.doMock('../../js-frameworks-lib/load-loader-options', () => ({
      loadLoaderOptions: vi.fn(async () => ({foo: 1}))
    }))
    const VueLoaderPluginMock = function (this: any) {
      this.apply = vi.fn()
    } as any
    vi.doMock('module', () => ({
      createRequire: () => {
        const req = ((id: string) => {
          if (id === 'vue-loader') {
            return {VueLoaderPlugin: VueLoaderPluginMock}
          }
          throw new Error(`Cannot find module ${id}`)
        }) as any
        req.resolve = (id: string) => `/project/node_modules/${id}`
        return req
      }
    }))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingVue, maybeUseVue} = await import('../../js-tools/vue')

    expect(isUsingVue('/p')).toBe(true)
    expect(isUsingVue('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)

    const result = await maybeUseVue('/p', 'development')
    expect(result?.loaders?.[0].test).toEqual(/\.vue$/)
    expect(result?.loaders?.[0].options?.foo).toBe(1)
    expect(result?.plugins?.length).toBeGreaterThan(0)
    expect(result?.alias?.['vue$']).toContain('/project/node_modules/vue')
    expect(result?.alias?.['@vue/runtime-dom']).toContain(
      '/project/node_modules/@vue/runtime-dom'
    )
    expect(result?.alias?.['@vue/runtime-core']).toContain(
      '/project/node_modules/@vue/runtime-core'
    )
    expect(result?.alias?.['@vue/shared']).toContain(
      '/project/node_modules/@vue/shared'
    )
  })
})
