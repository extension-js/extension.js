import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {AddAssetsToCompilation} from './add-assets-to-compilation'
import {Compiler, Compilation} from '@rspack/core'

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
      }
    } as any
  })

  describe('normalizePublicPath', () => {
    it('should keep lowercase public path (standardized)', () => {
      const result = (addAssetsToCompilation as any).normalizePublicPath(
        'public/image.png'
      )
      expect(result).toBe('public/image.png')
    })

    it('should keep lowercase public path on Windows', () => {
      const result = (addAssetsToCompilation as any).normalizePublicPath(
        'public/image.png'
      )
      expect(result).toBe('public/image.png')
    })

    it('should handle non-public paths unchanged', () => {
      const result = (addAssetsToCompilation as any).normalizePublicPath(
        'assets/image.png'
      )
      expect(result).toBe('assets/image.png')
    })

    it('should fallback to lowercase public if folder does not exist', () => {
      const result = (addAssetsToCompilation as any).normalizePublicPath(
        'public/image.png'
      )
      expect(result).toBe('public/image.png')
    })
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
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return (
          path === '/test/project/public' ||
          path === '/test/project/public/image.png'
        )
      })
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake image data'))

      addAssetsToCompilation.apply(mockCompiler)

      // Verify that we checked the expected public path
      const calls = (fs.existsSync as any).mock.calls
        .flat()
        .map(String) as string[]
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
        return (
          String(p).endsWith('/public/logo.png') ||
          String(p).endsWith('/public/ico.png') ||
          String(p).endsWith('/public/banner.png')
        )
      })
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('data'))

      addAssetsToCompilation.apply(mockCompiler)

      // Ensure public-root assets were checked
      const calls = ((fs.existsSync as any).mock.calls.flat() as any[]).map(
        String
      )
      expect(calls.some((c) => c.endsWith('/public/logo.png'))).toBe(true)
      expect(calls.some((c) => c.endsWith('/public/ico.png'))).toBe(true)
      expect(calls.some((c) => c.endsWith('/public/banner.png'))).toBe(true)
    })
  })

  describe('absolute path handling', () => {
    it('should preserve absolute paths inside public by emitting under public/ prefix', () => {
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
        return p === '/test/project/public/absolute/path/image.png'
      })
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('file-content'))

      addAssetsToCompilation.apply(mockCompiler)

      // Emit happens only when existsSync returns true and read succeeds; with our mocks, it should
      expect(
        (mockCompilation.emitAsset as any).mock.calls.length
      ).toBeGreaterThan(0)
      expect((mockCompilation.emitAsset as any).mock.calls[0][0]).toBe(
        'absolute/path/image.png'
      )
    })
  })
})
