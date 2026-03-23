import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../../../optional-deps-lib', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => true),
  resolveDevelopInstallRoot: vi.fn(() => undefined),
  resolveOptionalInstallRoot: vi.fn(() => '/tmp/extensionjs-optional-deps')
}))

describe('less tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingLess returns true when dependency is present and logs once', async () => {
    const integrations = (await import('../../../optional-deps-lib')) as any
    integrations.hasDependency.mockImplementation(
      (_p: string, dep: string) => dep === 'less'
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingLess} = await import('../../css-tools/less')
    expect(isUsingLess('/p')).toBe(true)
    expect(isUsingLess('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('maybeUseLess returns an array (rules or empty) depending on env', async () => {
    const less = await import('../../css-tools/less')
    // In some environments less-loader may be present; just assert array shape.
    const result = await less.maybeUseLess('/p', '/p/manifest.json')
    expect(Array.isArray(result)).toBe(true)
  })
})
