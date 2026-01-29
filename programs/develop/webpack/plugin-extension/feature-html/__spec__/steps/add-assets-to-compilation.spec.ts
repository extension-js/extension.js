import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'
import {Compiler, Compilation} from '@rspack/core'

const toPosix = (value: string) => value.replace(/\\/g, '/')

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn()
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn()
}))

describe('AddAssetsToCompilation', () => {
  let addAssetsToCompilation: AddAssetsToCompilation
  let mockCompiler: Compiler
  let mockCompilation: Compilation

  beforeEach(() => {
    addAssetsToCompilation = new AddAssetsToCompilation({
      manifestPath: '/test/project/manifest.json'
    })

    mockCompilation = {
      errors: [],
      getAsset: vi.fn(),
      emitAsset: vi.fn(),
      warnings: [],
      options: {output: {path: '/test/out/chrome'}},
      hooks: {
        processAssets: {
          tap: (_opts: any, fn: any) => fn()
        }
      }
    } as any

    mockCompiler = {
      hooks: {
        thisCompilation: {
          tap: vi.fn((name, callback) => {
            callback(mockCompilation)
          })
        }
      },
      options: {context: '/test/project'}
    } as any
  })

  describe('apply', () => {
    it('should handle standardized lowercase public folder paths correctly', () => {
      // Mock the compilation asset
      const mockAsset = {
        source: {
          source: () => '<html><img src="/public/image.png"></html>'
        }
      }

      // Provide includeList so the plugin processes this HTML
      addAssetsToCompilation = new AddAssetsToCompilation({
        manifestPath: '/test/project/manifest.json',
        includeList: {feature: '/test/project/resource.html'} as any
      })

      vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
        return name === 'resource.html' ? (mockAsset as any) : undefined
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

      // Verify that we checked the expected public path
      const calls = (fs.existsSync as any).mock.calls
        .flat()
        .map((value: any) => toPosix(String(value))) as string[]
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
        includeList: {feature: '/test/project/resource.html'} as any
      })

      vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
        return name === 'resource.html' ? (mockAsset as any) : undefined
      })
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        const normalized = toPosix(String(p))
        return (
          normalized.endsWith('/public/logo.png') ||
          normalized.endsWith('/public/ico.png') ||
          normalized.endsWith('/public/banner.png')
        )
      })
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('data'))

      addAssetsToCompilation.apply(mockCompiler)

      // Ensure public-root assets were checked
      const calls = ((fs.existsSync as any).mock.calls.flat() as any[]).map(
        (value: any) => toPosix(String(value))
      )
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
        includeList: {feature: '/test/project/resource.html'} as any
      })

      vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
        return name === 'resource.html' ? (mockAsset as any) : undefined
      })
      vi.mocked(fs.existsSync).mockImplementation((p: any) => {
        return (
          toPosix(String(p)) === '/test/project/public/absolute/path/image.png'
        )
      })
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('file-content'))

      addAssetsToCompilation.apply(mockCompiler)

      // With public/ delegation, HTML plugin should not emit assets under public
      expect((mockCompilation as any).emitAsset.mock.calls.length).toBe(0)
    })
  })

  it('shows public-root hint only for extension-root absolute (leading /) paths', () => {
    // HTML references a missing root asset and a missing relative asset
    const mockAsset = {
      source: {
        source: () =>
          '<html><img src="/missing.png"><img src="img/miss.png"></html>'
      }
    }

    addAssetsToCompilation = new AddAssetsToCompilation({
      manifestPath: '/test/project/manifest.json',
      includeList: {feature: '/test/project/resource.html'} as any
    })

    vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
      return name === 'resource.html' ? (mockAsset as any) : undefined
    })

    // Simulate not found in both public and output roots
    vi.mocked(fs.existsSync).mockImplementation((p: any) => false)
    vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from(''))

    addAssetsToCompilation.apply(mockCompiler)

    const warnings = String(mockCompilation.warnings.map(String).join('\n'))
    // Hint appears for root-absolute
    expect(warnings).toMatch(/resolved from the extension output root/i)
    // Hint omitted for relative path
    const relativeWarning = mockCompilation.warnings
      .map(String)
      .find((w: string) => w.includes('img/miss.png'))
    expect(relativeWarning || '').not.toMatch(
      /resolved from the extension output root/i
    )
  })

  it('emits warnings for remote <script>/<link> references without failing build', () => {
    // HTML referencing remote resources
    const mockAsset = {
      source: {
        source: () =>
          '<html><head><link rel="stylesheet" href="https://cdn.example.com/x.css"></head><body><script src="//cdn.example.com/y.js"></script></body></html>'
      }
    }

    addAssetsToCompilation = new AddAssetsToCompilation({
      manifestPath: '/test/project/manifest.json',
      includeList: {feature: '/test/project/resource.html'} as any
    })

    vi.mocked(mockCompilation.getAsset).mockImplementation((name: string) => {
      return name === 'resource.html' ? (mockAsset as any) : undefined
    })
    ;(fs.existsSync as any).mockReturnValue(false)
    ;(fs.readFileSync as any).mockReturnValue(Buffer.from(''))

    addAssetsToCompilation.apply(mockCompiler)

    expect(mockCompilation.warnings.length).toBeGreaterThan(0)
    const text = mockCompilation.warnings.map(String).join('\n')
    expect(text).toMatch(/Remote <(script|style)>/i)
    expect(text).toMatch(/cdn\.example\.com\/.+\.css/i)
    expect(text).toMatch(/cdn\.example\.com\/.+\.js/i)
    // Should not produce errors
    expect(mockCompilation.errors.length).toBe(0)
  })
})
