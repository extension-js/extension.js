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
      warnings: []
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
    it('should normalize public path to match actual folder case on macOS', () => {
      // Mock fs.existsSync to simulate Public folder on macOS
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === '/test/project/Public'
      })

      const result = (addAssetsToCompilation as any).normalizePublicPath(
        'public/image.png'
      )
      expect(result).toBe('Public/image.png')
    })

    it('should keep lowercase public path on Windows', () => {
      // Mock fs.existsSync to simulate public folder on Windows
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === '/test/project/public'
      })

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
      // Mock fs.existsSync to return false for all public folder variations
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = (addAssetsToCompilation as any).normalizePublicPath(
        'public/image.png'
      )
      expect(result).toBe('public/image.png')
    })
  })

  describe('apply', () => {
    it('should handle case-sensitive public folder paths correctly', () => {
      // Mock the compilation asset
      const mockAsset = {
        source: {
          source: () => '<html><img src="/Public/image.png"></html>'
        }
      }

      vi.mocked(mockCompilation.getAsset).mockReturnValue(mockAsset as any)
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        return path === '/test/project/Public/image.png'
      })
      vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from('fake image data'))

      addAssetsToCompilation.apply(mockCompiler)

      // Verify that the asset path was normalized correctly
      expect(fs.existsSync).toHaveBeenCalledWith(
        '/test/project/Public/image.png'
      )
    })
  })
})
