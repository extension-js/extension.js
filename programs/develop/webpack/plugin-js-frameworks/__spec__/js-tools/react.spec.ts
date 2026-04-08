import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

let ReactRefreshPluginCtor: any = class ReactRefreshPluginMock {
  options: any
  apply: any

  constructor(options: any) {
    this.options = options
    this.apply = vi.fn()
  }
}

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
}))

vi.mock('../../../webpack-lib/optional-deps-resolver', () => ({
  resolveOptionalContractPackageWithoutInstall: vi.fn(
    () => '/mock/react-refresh'
  ),
  loadOptionalContractModuleWithoutInstall: vi.fn(() => ReactRefreshPluginCtor)
}))

// Ensure require.resolve('react-refresh') succeeds to avoid install+exit
const originalResolve = (require as any).resolve
beforeEach(() => {
  ;(require as any).resolve = vi.fn((id: string) =>
    id === 'react-refresh' ? '/mock/react-refresh' : originalResolve(id)
  )
})
afterEach(() => {
  ;(require as any).resolve = originalResolve
})

describe('react tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ReactRefreshPluginCtor = class ReactRefreshPluginMock {
      options: any
      apply: any

      constructor(options: any) {
        this.options = options
        this.apply = vi.fn()
      }
    }
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingReact logs once when dependency present; maybeUseReact returns aliases and plugin', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'react'
    )

    ReactRefreshPluginCtor = function (this: any, options: any) {
      this.options = options
      this.apply = vi.fn()
    } as any
    // Mock module.createRequire to control both resolve() and require() paths.
    vi.doMock('module', () => ({
      createRequire: () => {
        const req = ((id: string) => {
          if (id === '@rspack/plugin-react-refresh') {
            return {default: ReactRefreshPluginCtor}
          }
          throw new Error(`Cannot find module ${id}`)
        }) as any
        req.resolve = (id: string) => `/project/node_modules/${id}`
        return req
      }
    }))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const {isUsingReact, maybeUseReact} = await import('../../js-tools/react')

    expect(isUsingReact('/p')).toBe(true)
    expect(isUsingReact('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)

    const refreshExclude = vi.fn(() => false)
    const result = await maybeUseReact('/p', {refreshExclude})
    expect(result?.plugins?.length).toBeGreaterThan(0)
    expect((result?.plugins?.[0] as any)?.options?.exclude).toBe(refreshExclude)
    expect(result?.alias?.['react$']).toContain('/project/node_modules/react')
    expect(result?.alias?.['react-dom$']).toContain(
      '/project/node_modules/react-dom'
    )
    expect(result?.alias?.['react/jsx-runtime']).toContain(
      '/project/node_modules/react/jsx-runtime'
    )
    expect(result?.alias?.['react/jsx-dev-runtime']).toContain(
      '/project/node_modules/react/jsx-dev-runtime'
    )
  })

  it('throws when optional react tooling cannot be resolved', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'react'
    )

    const optionalResolver = (await import(
      '../../../webpack-lib/optional-deps-resolver'
    )) as any
    optionalResolver.resolveOptionalContractPackageWithoutInstall.mockImplementationOnce(
      () => {
        throw new Error('optional deps missing')
      }
    )

    vi.doMock('module', () => ({
      createRequire: () => {
        const req = (() => {
          throw new Error('not expected')
        }) as any
        req.resolve = (id: string) => `/project/node_modules/${id}`
        return req
      }
    }))

    const {maybeUseReact} = await import('../../js-tools/react')
    await expect(maybeUseReact('/p')).rejects.toThrow(
      new Error('optional deps missing')
    )
  })

  it('skips react refresh plugin when disabled explicitly', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'react'
    )

    const {maybeUseReact} = await import('../../js-tools/react')
    const result = await maybeUseReact('/p', {disableRefresh: true})

    expect(result?.plugins).toEqual([])
    expect(result?.alias?.['react$']).toContain('/project/node_modules/react')
  })
})
