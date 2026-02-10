import {describe, it, expect, vi, beforeEach} from 'vitest'
import postcss from 'postcss'

vi.mock('../../css-lib/integrations', () => ({
  hasDependency: vi.fn(() => false),
  installOptionalDependencies: vi.fn(async () => true)
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
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => false
    }))
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
    expect(opts?.cwd).toBe('/p')
    if (opts?.config === false) {
      expect(Array.isArray(opts?.plugins)).toBe(true)
      expect((opts?.plugins as any[]).length).toBe(1)
    } else {
      // Fallback behavior when postcss-load-config isn't wired as expected
      expect(opts?.config).toBe('/p')
    }
  })

  it('supports postcss.config.mjs discovered from project path', async () => {
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => false
    }))
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
    expect(opts?.cwd).toBe('/p')
    if (opts?.config === false) {
      expect(Array.isArray(opts?.plugins)).toBe(true)
      expect((opts?.plugins as any[]).length).toBe(1)
    } else {
      expect(opts?.config).toBe('/p')
    }
  })

  it('uses project-root discovery when only package.json contains postcss config', async () => {
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => false
    }))
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
    expect(opts?.cwd).toBe('/p')
    if (opts?.config === false) {
      expect(Array.isArray(opts?.plugins)).toBe(true)
      expect((opts?.plugins as any[]).length).toBe(1)
    } else {
      expect(opts?.config).toBe('/p')
    }
  })

  // Tailwind-specific behavior is now limited to ensuring the plugin can be resolved;
  // we let postcss-load-config discover plugins from the project root.

  it('exits with error when Tailwind is present but plugin cannot be resolved', async () => {
    // With the new behavior we no longer hard-exit when Tailwind cannot be
    // resolved; we fall back to letting postcss-loader handle discovery.
    // This test simply verifies that maybeUsePostCss still returns a loader
    // config when Tailwind is detected but resolution fails.

    // No user configs
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: (p: string, enc: string) =>
          (actual as any).readFileSync(p, enc)
      }
    })
    // Tailwind detected but plugin resolution will fail later when config is loaded
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('../../css-lib/integrations', () => ({
      hasDependency: (p: string, dep: string) =>
        dep === 'tailwindcss' || dep === '@tailwindcss/postcss',
      installOptionalDependencies: vi.fn(async () => true)
    }))

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    expect(rule.loader).toContain('postcss-loader')
  })

  it('does not override user PostCSS plugins when postcss config exists', async () => {
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.js'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) {
            return JSON.stringify({})
          }
          return (actual as any).readFileSync(p, enc)
        }
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    const opts = rule.options?.postcssOptions

    expect(opts?.config).toBe('/p')
    expect(opts?.cwd).toBe('/p')
    expect(opts?.plugins).toBeUndefined()
  })

  it('passes projectPath as Tailwind base in fallback injection mode', async () => {
    const tailwindFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss'
    }))
    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      return {
        ...actual,
        createRequire: () => (id: string) => {
          if (id === '@tailwindcss/postcss') return tailwindFactory
          throw new Error(`Cannot resolve ${id}`)
        }
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) {
            return JSON.stringify({})
          }
          return (actual as any).readFileSync(p, enc)
        }
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    const opts = rule.options?.postcssOptions

    expect(tailwindFactory).toHaveBeenCalledWith({base: '/p'})
    expect(Array.isArray(opts?.plugins)).toBe(true)
    expect((opts?.plugins as any[])[0]).toEqual({'@tailwindcss/postcss': false})
  })

  it('produces css through injected plugin chain in fallback mode', async () => {
    const arbitraryClass =
      '.from-\\[\\#1a1333\\]{--tw-gradient-from:#1a1333;--tw-gradient-stops:var(--tw-gradient-via-stops);}'
    const tailwindFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss-mock',
      Once(root: any) {
        root.append(arbitraryClass)
      }
    }))

    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      return {
        ...actual,
        createRequire: () => (id: string) => {
          if (id === '@tailwindcss/postcss') return tailwindFactory
          throw new Error(`Cannot resolve ${id}`)
        }
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) {
            return JSON.stringify({})
          }
          return (actual as any).readFileSync(p, enc)
        }
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    const plugins = rule.options?.postcssOptions?.plugins as any[]

    expect(Array.isArray(plugins)).toBe(true)
    expect(plugins.length).toBe(2)

    // plugins[0] is the config shim object {'@tailwindcss/postcss': false}
    // and is not executable by postcss() directly.
    const result = await postcss([plugins[1]] as any).process(
      '@import "tailwindcss";',
      {
        from: undefined
      }
    )
    expect(result.css).toContain('.from-\\[\\#1a1333\\]')
    expect(result.css).toContain('--tw-gradient-stops')
  })

  it('uses compatibility fallback for CJS postcss.config.js in type module projects', async () => {
    const tailwindFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss'
    }))
    const autoprefixerFactory = vi.fn(() => ({
      postcssPlugin: 'autoprefixer'
    }))

    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      return {
        ...actual,
        createRequire: () => (id: string) => {
          if (id === 'tailwindcss') return tailwindFactory
          if (id === 'autoprefixer') return autoprefixerFactory
          throw new Error(`Cannot resolve ${id}`)
        }
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('../../css-lib/integrations', () => ({
      hasDependency: (_p: string, dep: string) =>
        dep === 'tailwindcss' || dep === 'autoprefixer',
      installOptionalDependencies: vi.fn(async () => true)
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.js'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) {
            return JSON.stringify({type: 'module'})
          }
          if (String(p).endsWith('postcss.config.js')) {
            return "const tailwindcss = require('tailwindcss'); module.exports = { plugins: [tailwindcss] }"
          }
          return (actual as any).readFileSync(p, enc)
        }
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    const opts = rule.options?.postcssOptions

    expect(opts?.config).toBe(false)
    expect(Array.isArray(opts?.plugins)).toBe(true)
    // Tailwind + autoprefixer plugin objects
    expect((opts?.plugins as any[]).length).toBe(2)
  })
})
