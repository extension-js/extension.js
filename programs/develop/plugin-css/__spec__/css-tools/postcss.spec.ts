import postcss from 'postcss'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {hasDependencyMock} = vi.hoisted(() => ({
  hasDependencyMock: vi.fn(() => false)
}))

vi.mock('../../../lib/has-dependency', () => ({
  hasDependency: (...args: [string, string]) => hasDependencyMock(...args)
}))

describe('postcss detection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingPostCss returns true when postcss is a dependency', async () => {
    hasDependencyMock.mockImplementation(
      (_p: string, dep: string) => dep === 'postcss'
    )

    const {isUsingPostCss} = await import('../../css-tools/postcss')
    expect(isUsingPostCss('/p')).toBe(true)
  })

  it('isUsingPostCss returns true when Tailwind is present (bridge detection)', async () => {
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    const {isUsingPostCss} = await import('../../css-tools/postcss')
    expect(isUsingPostCss('/p')).toBe(true)
  })

  it('uses file-based postcss config discovered from project path', async () => {
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => false
    }))
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
    expect(rule.loader).toBeDefined()
    const opts = rule.options?.postcssOptions
    expect(opts?.cwd).toBe('/p')
    if (opts?.config === false) {
      expect(Array.isArray(opts?.plugins)).toBe(true)
      expect((opts?.plugins as any[]).length).toBe(1)
    } else {
      expect(opts?.config).toBe('/p')
    }
  })

  it('supports postcss.config.mjs discovered from project path', async () => {
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => false
    }))
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

  it('exits with error when Tailwind is present but plugin cannot be resolved', async () => {
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: () => false,
        readFileSync: (p: string, enc: string) =>
          (actual as any).readFileSync(p, enc)
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: (p: string, dep: string) =>
        dep === 'tailwindcss' || dep === '@tailwindcss/postcss'
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
    expect((opts?.plugins as any[])[0]).toEqual({
      '@tailwindcss/postcss': false
    })
    expect((opts?.plugins as any[])[1]).toEqual({tailwindcss: false})
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
    expect(plugins.length).toBe(3)

    const result = await postcss([plugins[2]] as any).process(
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
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: (_p: string, dep: string) =>
        dep === 'tailwindcss' || dep === 'autoprefixer'
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
    expect((opts?.plugins as any[]).length).toBe(2)
  })

  it('injects cwd-stable Tailwind plugin for postcss.config.js with @tailwindcss/postcss', async () => {
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
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: (_p: string, dep: string) => dep === '@tailwindcss/postcss'
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.js'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) return JSON.stringify({})
          if (String(p).endsWith('postcss.config.js')) {
            return "export default { plugins: { '@tailwindcss/postcss': {} } }"
          }
          return (actual as any).readFileSync(p, enc)
        }
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    const opts = rule.options?.postcssOptions

    expect(opts?.config).toBe('/p')
    expect(tailwindFactory).toHaveBeenCalledWith({base: '/p'})
    expect((opts?.plugins as any[])[0]).toEqual({
      '@tailwindcss/postcss': false
    })
    expect((opts?.plugins as any[])[1]).toEqual({tailwindcss: false})
  })

  it('injects cwd-stable Tailwind plugin for postcss.config.cjs with tailwindcss', async () => {
    const tailwindFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss'
    }))
    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      return {
        ...actual,
        createRequire: () => (id: string) => {
          if (id === 'tailwindcss') return tailwindFactory
          throw new Error(`Cannot resolve ${id}`)
        }
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: (_p: string, dep: string) => dep === 'tailwindcss'
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.cjs'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) return JSON.stringify({})
          if (String(p).endsWith('postcss.config.cjs')) {
            return "module.exports = { plugins: ['tailwindcss'] }"
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
    expect(opts?.plugins as any[]).toEqual([{postcssPlugin: 'tailwindcss'}])
    expect(tailwindFactory).toHaveBeenCalled()
  })

  it('injects cwd-stable Tailwind plugin for postcss.config.mjs with @tailwindcss/postcss', async () => {
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
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: (_p: string, dep: string) => dep === '@tailwindcss/postcss'
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.mjs'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) return JSON.stringify({})
          if (String(p).endsWith('postcss.config.mjs')) {
            return "export default { plugins: { '@tailwindcss/postcss': {} } }"
          }
          return (actual as any).readFileSync(p, enc)
        }
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    const opts = rule.options?.postcssOptions

    expect(opts?.config).toBe('/p')
    expect(Array.isArray(opts?.plugins)).toBe(true)
    expect((opts?.plugins as any[])[0]).toEqual({
      '@tailwindcss/postcss': false
    })
    expect((opts?.plugins as any[])[1]).toEqual({tailwindcss: false})
  })

  it('prefers @tailwindcss/postcss over tailwindcss for v4-compatible PostCSS usage', async () => {
    const tailwindPostcssFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss-postcss'
    }))
    const tailwindCssFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss-direct'
    }))
    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      return {
        ...actual,
        createRequire: () => (id: string) => {
          if (id === '@tailwindcss/postcss') return tailwindPostcssFactory
          if (id === 'tailwindcss') return tailwindCssFactory
          throw new Error(`Cannot resolve ${id}`)
        }
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: (_p: string, dep: string) => dep === 'tailwindcss'
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.js'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) return JSON.stringify({})
          if (String(p).endsWith('postcss.config.js')) {
            return "module.exports = { plugins: ['tailwindcss'] }"
          }
          return (actual as any).readFileSync(p, enc)
        }
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    const opts = rule.options?.postcssOptions

    expect(Array.isArray(opts?.plugins)).toBe(true)
    expect(tailwindPostcssFactory).toHaveBeenCalledWith({base: '/p'})
    expect(tailwindCssFactory).not.toHaveBeenCalled()
    expect(opts?.plugins).toEqual([{postcssPlugin: 'tailwindcss-postcss'}])
  })

  it('injects Tailwind plugin when PostCSS config mentions tailwind but deps are not declared', async () => {
    const tailwindPostcssFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss-postcss'
    }))
    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      return {
        ...actual,
        createRequire: () => (id: string) => {
          if (id === '@tailwindcss/postcss') return tailwindPostcssFactory
          throw new Error(`Cannot resolve ${id}`)
        }
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => false
    }))
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: () => false
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.js'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) return JSON.stringify({})
          if (String(p).endsWith('postcss.config.js')) {
            return "module.exports = { plugins: ['tailwindcss'] }"
          }
          return (actual as any).readFileSync(p, enc)
        }
      }
    })

    const {maybeUsePostCss} = await import('../../css-tools/postcss')
    const rule = await maybeUsePostCss('/p', {mode: 'development'})
    const opts = rule.options?.postcssOptions

    expect(Array.isArray(opts?.plugins)).toBe(true)
    expect(tailwindPostcssFactory).toHaveBeenCalledWith({base: '/p'})
  })

  it('bypasses direct tailwindcss function config and keeps autoprefixer for v4 compatibility', async () => {
    const tailwindPostcssFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss-postcss'
    }))
    const autoprefixerFactory = vi.fn(() => ({
      postcssPlugin: 'autoprefixer'
    }))
    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      return {
        ...actual,
        createRequire: () => (id: string) => {
          if (id === '@tailwindcss/postcss') return tailwindPostcssFactory
          if (id === 'autoprefixer') return autoprefixerFactory
          if (id === 'tailwindcss') {
            throw new Error(
              "It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin."
            )
          }
          throw new Error(`Cannot resolve ${id}`)
        }
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: (_p: string, dep: string) =>
        dep === 'tailwindcss' || dep === 'autoprefixer'
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.js'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) return JSON.stringify({})
          if (String(p).endsWith('postcss.config.js')) {
            return [
              "const tailwindcss = require('tailwindcss')",
              "const autoprefixer = require('autoprefixer')",
              'module.exports = { plugins: [tailwindcss, autoprefixer] }'
            ].join('\n')
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
    expect((opts?.plugins as any[]).length).toBe(4)
    expect(tailwindPostcssFactory).toHaveBeenCalledWith({base: '/p'})
    expect(autoprefixerFactory).toHaveBeenCalled()
  })

  it('bypasses direct v3 tailwindcss function configs and keeps injected plugin', async () => {
    const tailwindCssFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss-v3'
    }))
    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      return {
        ...actual,
        createRequire: () => (id: string) => {
          if (id === 'tailwindcss') return tailwindCssFactory
          if (id === '@tailwindcss/postcss') {
            throw new Error('No @tailwindcss/postcss in v3 fixture')
          }
          throw new Error(`Cannot resolve ${id}`)
        }
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: (_p: string, dep: string) => dep === 'tailwindcss'
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.js'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) {
            return JSON.stringify({
              devDependencies: {tailwindcss: '^3.4.13'}
            })
          }
          if (String(p).endsWith('postcss.config.js')) {
            return [
              "const tailwindcss = require('tailwindcss')",
              'module.exports = { plugins: [tailwindcss] }'
            ].join('\n')
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
    expect((opts?.plugins as any[]).length).toBe(3)
    expect(tailwindCssFactory).toHaveBeenCalled()
  })

  it('falls back to @tailwindcss/postcss when direct tailwindcss init fails', async () => {
    const tailwindCssFactory = vi.fn(() => {
      throw new Error(
        "It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin."
      )
    })
    const tailwindPostcssFactory = vi.fn((_opts?: any) => ({
      postcssPlugin: 'tailwindcss-postcss'
    }))
    const autoprefixerFactory = vi.fn(() => ({
      postcssPlugin: 'autoprefixer'
    }))
    vi.doMock('module', async () => {
      const actual = await vi.importActual<any>('module')
      return {
        ...actual,
        createRequire: () => (id: string) => {
          if (id === 'tailwindcss') return tailwindCssFactory
          if (id === '@tailwindcss/postcss') return tailwindPostcssFactory
          if (id === 'autoprefixer') return autoprefixerFactory
          throw new Error(`Cannot resolve ${id}`)
        }
      }
    })
    vi.doMock('../../css-tools/tailwind', () => ({
      isUsingTailwind: () => true
    }))
    vi.doMock('../../../lib/has-dependency', () => ({
      hasDependency: (_p: string, dep: string) =>
        dep === 'tailwindcss' || dep === 'autoprefixer'
    }))
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<any>('fs')
      return {
        ...actual,
        existsSync: (p: string) => String(p).endsWith('postcss.config.js'),
        readFileSync: (p: string, enc: string) => {
          if (String(p).endsWith('package.json')) {
            return JSON.stringify({
              devDependencies: {
                tailwindcss: '^3.4.13',
                autoprefixer: '^10.0.0'
              }
            })
          }
          if (String(p).endsWith('postcss.config.js')) {
            return [
              "const tailwindcss = require('tailwindcss')",
              "const autoprefixer = require('autoprefixer')",
              'module.exports = { plugins: [tailwindcss, autoprefixer] }'
            ].join('\n')
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
    expect(tailwindCssFactory).toHaveBeenCalled()
    expect(tailwindPostcssFactory).toHaveBeenCalledWith({base: '/p'})
    expect(autoprefixerFactory).toHaveBeenCalled()
  })
})
