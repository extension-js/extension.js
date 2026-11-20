import * as fs from 'node:fs'
import type {Asset, Compilation, Compiler} from '@rspack/core'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  asCompilation,
  asCompiler,
  type TapCallback
} from '../../../__spec__/helpers/rspack-fakes'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'

// The page asset only carries the source the step reads.
const asAsset = (fake: unknown) => fake as Readonly<Asset>

const toPosix = (value: string) => value.replace(/\\/g, '/')

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()

  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      statSync: vi.fn()
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn()
  }
})

describe('AddAssetsToCompilation', () => {
  let addAssetsToCompilation: AddAssetsToCompilation
  let mockCompiler: Compiler
  let mockCompilation: Compilation

  beforeEach(() => {
    addAssetsToCompilation = new AddAssetsToCompilation({
      manifestPath: '/test/project/manifest.json'
    })

    mockCompilation = asCompilation({
      errors: [],
      getAsset: vi.fn(),
      emitAsset: vi.fn(),
      warnings: [],
      options: {output: {path: '/test/out/chrome'}},
      hooks: {
        processAssets: {
          tap: (_opts: unknown, fn: TapCallback) => fn()
        }
      }
    })

    mockCompiler = asCompiler({
      hooks: {
        thisCompilation: {
          tap: vi.fn((_name, callback) => {
            callback(mockCompilation)
          })
        }
      },
      options: {context: '/test/project'}
    })
  })

  describe('apply', () => {
    it('should handle standardized lowercase public folder paths correctly', () => {
      const mockAsset = {
        source: {
          source: () => '<html><img src="/public/image.png"></html>'
        }
      }

      addAssetsToCompilation = new AddAssetsToCompilation({
        manifestPath: '/test/project/manifest.json',
        includeList: {feature: '/test/project/resource.html'}
      })

      vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
        return name === 'feature.html' ? asAsset(mockAsset) : undefined
      })

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const normalized = toPosix(String(p))

        return (
          normalized === '/test/project/public' ||
          normalized === '/test/project/public/image.png'
        )
      })

      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake image data'))

      addAssetsToCompilation.apply(mockCompiler)

      const calls = vi
        .mocked(fs.existsSync)
        .mock.calls.flat()
        .map((value) => toPosix(String(value)))
      expect(calls.includes('/test/project/public/image.png')).toBe(true)
    })

    it('should resolve root "/" and "./public" paths to output root', () => {
      const mockAsset = {
        source: {
          source: () =>
            '<html><img src="/logo.png"><img src="./public/ico.png"><img src="public/banner.png"></html>'
        }
      }

      addAssetsToCompilation = new AddAssetsToCompilation({
        manifestPath: '/test/project/manifest.json',
        includeList: {feature: '/test/project/resource.html'}
      })

      vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
        return name === 'feature.html' ? asAsset(mockAsset) : undefined
      })

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const normalized = toPosix(String(p))

        return (
          normalized.endsWith('/public/logo.png') ||
          normalized.endsWith('/public/ico.png') ||
          normalized.endsWith('/public/banner.png')
        )
      })

      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('data'))

      addAssetsToCompilation.apply(mockCompiler)

      const calls = vi
        .mocked(fs.existsSync)
        .mock.calls.flat()
        .map((value) => toPosix(String(value)))
      expect(calls.some((c) => c.endsWith('/public/logo.png'))).toBe(true)
      expect(calls.some((c) => c.endsWith('/public/ico.png'))).toBe(true)
      expect(calls.some((c) => c.endsWith('/public/banner.png'))).toBe(true)
    })
  })

  describe('absolute path handling', () => {
    it('should not emit assets that are under public; rely on copy mechanism', () => {
      const mockAsset = {
        source: {
          source: () => '<html><img src="/absolute/path/image.png"></html>'
        }
      }

      addAssetsToCompilation = new AddAssetsToCompilation({
        manifestPath: '/test/project/manifest.json',
        includeList: {feature: '/test/project/resource.html'}
      })

      vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
        return name === 'feature.html' ? asAsset(mockAsset) : undefined
      })

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return (
          toPosix(String(p)) === '/test/project/public/absolute/path/image.png'
        )
      })

      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('file-content'))

      addAssetsToCompilation.apply(mockCompiler)

      expect(vi.mocked(mockCompilation.emitAsset).mock.calls.length).toBe(0)
    })
  })

  it('shows public-root hint only for extension-root absolute (leading /) paths', () => {
    const mockAsset = {
      source: {
        source: () =>
          '<html><img src="/missing.png"><img src="img/miss.png"></html>'
      }
    }

    addAssetsToCompilation = new AddAssetsToCompilation({
      manifestPath: '/test/project/manifest.json',
      includeList: {feature: '/test/project/resource.html'}
    })

    vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
      return name === 'feature.html' ? asAsset(mockAsset) : undefined
    })

    vi.mocked(fs.existsSync).mockImplementation((_p) => false)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(''))

    addAssetsToCompilation.apply(mockCompiler)

    const warnings = String(mockCompilation.warnings.map(String).join('\n'))
    expect(warnings).toMatch(/resolves from the extension root/i)
    const relativeWarning = mockCompilation.warnings
      .map(String)
      .find((w: string) => w.includes('img/miss.png'))
    expect(relativeWarning || '').not.toMatch(
      /resolves from the extension root/i
    )
  })

  it('emits warnings for remote <script>/<link> references without failing build', () => {
    const mockAsset = {
      source: {
        source: () =>
          '<html><head><link rel="stylesheet" href="https://cdn.example.com/x.css"></head><body><script src="//cdn.example.com/y.js"></script></body></html>'
      }
    }

    addAssetsToCompilation = new AddAssetsToCompilation({
      manifestPath: '/test/project/manifest.json',
      includeList: {feature: '/test/project/resource.html'}
    })

    vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
      return name === 'feature.html' ? asAsset(mockAsset) : undefined
    })

    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(''))

    addAssetsToCompilation.apply(mockCompiler)

    expect(mockCompilation.warnings.length).toBeGreaterThan(0)
    const text = mockCompilation.warnings.map(String).join('\n')
    expect(text).toMatch(/Remote <(script|style)>/i)
    expect(text).toMatch(/cdn\.example\.com\/.+\.css/i)
    expect(text).toMatch(/cdn\.example\.com\/.+\.js/i)
    expect(mockCompilation.errors.length).toBe(0)
  })
})
