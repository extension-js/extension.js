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

  it('loads plugins from file-based postcss config and disables config discovery', async () => {
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

    // Mock createRequire to return our config and plugin modules
    vi.doMock('module', () => ({
      createRequire: (_: string) => {
        const req = (id: string) => {
          if (id.endsWith('postcss.config.js')) {
            // Return mixed plugin shapes: string, tuple, map
            return {
              plugins: [
                'plugin-a',
                ['plugin-b', {b: true}],
                {postcss: () => 'plugin-c-fn'},
                {'plugin-d': true, 'plugin-e': {e: 1}, 'plugin-f': false}
              ]
            }
          }
          if (id === 'plugin-a') return () => 'plugin-a-fn'
          if (id === 'plugin-b') return () => 'plugin-b-fn'
          if (id === 'plugin-d') return () => 'plugin-d-fn'
          if (id === 'plugin-e') return () => 'plugin-e-fn'
          throw new Error('unexpected require: ' + id)
        }
        return req as any
      }
    }))

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    // Ensure loader configured
    expect(rule.loader).toBeDefined()
    const opts = rule.options?.postcssOptions
    expect(opts?.config).toBe(false)
    // Expect normalized plugins present (5 entries: a, b, c, d, e; f=false is skipped)
    expect(Array.isArray(opts?.plugins)).toBe(true)
    expect((opts?.plugins as any[]).length).toBe(5)
  })

  it('supports postcss.config.mjs presence and disables config discovery', async () => {
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

    vi.doMock('module', () => ({
      createRequire: (_: string) => {
        const req = (id: string) => {
          if (id.endsWith('postcss.config.mjs')) {
            return {
              plugins: {
                'plugin-x': true,
                'plugin-y': {y: 2}
              }
            }
          }
          if (id === 'plugin-x') return () => 'x'
          if (id === 'plugin-y') return () => 'y'
          throw new Error('unexpected require: ' + id)
        }
        return req as any
      }
    }))

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'production'})
    const opts = rule.options?.postcssOptions
    expect(opts?.config).toBe(false)
    expect(Array.isArray(opts?.plugins)).toBe(true)
    expect((opts?.plugins as any[]).length).toBe(2)
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
    // When using user config via discovery, we don't pre-supply plugins
    expect(Array.isArray(opts?.plugins)).toBe(true)
    expect((opts?.plugins as any[]).length).toBe(0)
  })
})
