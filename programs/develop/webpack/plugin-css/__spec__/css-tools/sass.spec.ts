import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../../css-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => true),
  resolveDevelopInstallRoot: vi.fn(() => undefined)
}))

describe('sass tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingSass returns true when dependency is present and logs once', async () => {
    const integrations = (await import('../../css-lib/integrations')) as any
    integrations.hasDependency.mockImplementation(
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
    // In some environments sass-loader may be present; just assert array shape.
    const result = await sass.maybeUseSass('/p')
    expect(Array.isArray(result)).toBe(true)
  })
})
