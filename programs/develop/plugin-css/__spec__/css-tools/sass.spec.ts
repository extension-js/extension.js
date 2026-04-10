import {describe, it, expect, vi, beforeEach} from 'vitest'

const {sassHasDependencyMock} = vi.hoisted(() => ({
  sassHasDependencyMock: vi.fn(() => false)
}))

vi.mock('../../../lib/has-dependency', () => ({
  hasDependency: (...args: [string, string]) => sassHasDependencyMock(...args)
}))

describe('sass tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingSass returns true when dependency is present and logs once', async () => {
    sassHasDependencyMock.mockImplementation(
      (_p: string, dep: string) => dep === 'sass'
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingSass} = await import('../../css-tools/sass')
    expect(isUsingSass('/p')).toBe(true)
    expect(isUsingSass('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('maybeUseSass returns an array (rules or empty) depending on env', async () => {
    const sass = await import('../../css-tools/sass')
    const result = await sass.maybeUseSass('/p')
    expect(Array.isArray(result)).toBe(true)
  })
})
