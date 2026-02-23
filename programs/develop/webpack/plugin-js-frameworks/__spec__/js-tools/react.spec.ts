import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => true),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
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
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingReact logs once when dependency present; maybeUseReact returns aliases and plugin', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'react'
    )

    const ReactRefreshPluginMock = function (this: any) {
      this.apply = vi.fn()
    } as any
    // Mock module.createRequire to control both resolve() and require() paths.
    vi.doMock('module', () => ({
      createRequire: () => {
        const req = ((id: string) => {
          if (id === '@rspack/plugin-react-refresh') {
            return {default: ReactRefreshPluginMock}
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

    const result = await maybeUseReact('/p')
    expect(result?.plugins?.length).toBeGreaterThan(0)
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
})
