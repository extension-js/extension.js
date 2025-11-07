import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

vi.mock('../../../webpack-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => undefined)
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
    ;(process as any).env.EXTENSION_ENV = 'development'
  })

  it('isUsingReact logs once when dependency present; maybeUseReact returns aliases and plugin', async () => {
    const integrations = (await import(
      '../../../webpack-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'react'
    )

    // Mock module.createRequire to control resolve() of project deps
    vi.doMock('module', () => ({
      createRequire: () => ({
        resolve: (id: string) => `/project/node_modules/${id}`
      })
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
  })
})
