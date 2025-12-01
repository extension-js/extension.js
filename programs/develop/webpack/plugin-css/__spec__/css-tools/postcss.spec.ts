import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('../../css-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => undefined)
}))

describe('postcss detection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
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

  it('uses file-based postcss config discovered from project path', async () => {
    // Simulate presence of postcss.config.js
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) =>
          String(p).endsWith('postcss.config.js') || actual.existsSync(p),
        readFileSync: actual.readFileSync
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    // Ensure loader configured
    expect(rule.loader).toBeDefined()
    const opts = rule.options?.postcssOptions
    expect(opts?.config).toBe('/p')
    // We don't pre-supply plugins; discovery will happen at runtime from /p
    expect(opts?.plugins).toBeUndefined()
  })

  it('supports postcss.config.mjs discovered from project path', async () => {
    // Simulate presence of postcss.config.mjs; still use createRequire path in tests
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) =>
          String(p).endsWith('postcss.config.mjs') || actual.existsSync(p),
        readFileSync: actual.readFileSync
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'production'})
    const opts = rule.options?.postcssOptions
    expect(opts?.config).toBe('/p')
    expect(opts?.plugins).toBeUndefined()
  })

  it('uses project-root discovery when only package.json contains postcss config', async () => {
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => {
          // No file configs
          if (String(p).includes('postcss.config')) return false
          return actual.existsSync(p)
        },
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) {
            return JSON.stringify({postcss: {}})
          }
          return (actual as any).readFileSync(p, enc)
        }
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    const opts = rule.options?.postcssOptions
    expect(opts?.config).toBe('/p')
    // We don't pre-supply plugins
    expect(opts?.plugins).toBeUndefined()
  })
})
