import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../../css-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => undefined)
}))

describe('less tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_ENV = 'development'
  })

  it('isUsingLess returns true when dependency is present and logs once', async () => {
    const integrations = (await import('../../css-lib/integrations')) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'less'
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingLess} = await import('../../css-tools/less')
    expect(isUsingLess('/p')).toBe(true)
    expect(isUsingLess('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('maybeUseLess returns empty array when not using less', async () => {
    const {maybeUseLess} = await import('../../css-tools/less')
    const result = await maybeUseLess('/p', '/p/manifest.json')
    expect(result).toEqual([])
  })
})
