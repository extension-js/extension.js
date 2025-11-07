import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

vi.mock('../../frameworks-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => undefined)
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
    ;(process as any).env.EXTENSION_ENV = 'development'
  })

  it('isUsingPreact logs once when dependency present; maybeUsePreact returns aliases and plugin', async () => {
    const integrations = (await import(
      '../../frameworks-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'preact'
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingPreact, maybeUsePreact} = await import(
      '../../js-tools/preact'
    )

    expect(isUsingPreact('/p')).toBe(true)
    expect(isUsingPreact('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)

    const result = await maybeUsePreact('/p')
    expect(result?.plugins?.length).toBeGreaterThan(0)
    expect(result?.alias?.react).toBe('preact/compat')
    expect(result?.alias?.['react/jsx-runtime']).toBe('preact/jsx-runtime')
  })
})
