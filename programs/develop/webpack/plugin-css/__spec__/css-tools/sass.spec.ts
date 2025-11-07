import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../../../webpack-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => undefined)
}))

describe('sass tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_ENV = 'development'
  })

  it('isUsingSass returns true when dependency is present and logs once', async () => {
    const integrations = (await import(
      '../../../webpack-lib/integrations'
    )) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'sass'
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingSass} = await import('../../css-tools/sass')
    expect(isUsingSass('/p')).toBe(true)
    expect(isUsingSass('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('maybeUseSass returns empty array when not using sass', async () => {
    const {maybeUseSass} = await import('../../css-tools/sass')
    const result = await maybeUseSass('/p')
    expect(result).toEqual([])
  })
})
