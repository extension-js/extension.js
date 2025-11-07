import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../../css-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => undefined)
}))

describe('postcss detection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_ENV = 'development'
  })

  it('isUsingPostCss returns true when postcss is a dependency', async () => {
    const integrations = (await import('../../css-lib/integrations')) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'postcss'
    )

    const {isUsingPostCss} = await import('../../css-tools/postcss')
    expect(isUsingPostCss('/p')).toBe(true)
  })

  it('isUsingPostCss returns true when Tailwind is present (bridge detection)', async () => {
    vi.doMock('../../css-tools/tailwind', () => ({isUsingTailwind: () => true}))
    const {isUsingPostCss} = await import('../../css-tools/postcss')
    expect(isUsingPostCss('/p')).toBe(true)
  })
})
