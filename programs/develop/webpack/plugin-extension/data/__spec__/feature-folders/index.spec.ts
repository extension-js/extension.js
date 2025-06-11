import * as path from 'path'
import {describe, it, expect, vi} from 'vitest'
import {getSpecialFoldersData} from '../../special-folders'
import {
  scanFilesInFolder,
  generateEntries
} from '../../special-folders/generate-entries'
import {type PluginInterface} from '../../../../webpack-types'

const mockContext = '/mock/context'
const mockManifestPath = path.join(mockContext, 'manifest.json')

// Mock file system structure
const mockFileSystem = {
  [path.join(mockContext, 'public')]: {
    'image1.png': '',
    'image2.jpg': '',
    'style.css': ''
  },
  [path.join(mockContext, 'pages')]: {
    'index.html': '',
    'about.html': '',
    'contact.html': '',
    'style.css': ''
  },
  [path.join(mockContext, 'scripts')]: {
    'main.js': '',
    'utils.ts': '',
    'component.tsx': '',
    'style.css': ''
  }
}

vi.mock('fs', () => ({
  existsSync: (filePath: string) => {
    return (
      Object.keys(mockFileSystem).includes(filePath) ||
      Object.values(mockFileSystem).some((folder) =>
        Object.keys(folder).includes(path.basename(filePath))
      )
    )
  },
  statSync: (filePath: string) => ({
    isDirectory: () => Object.keys(mockFileSystem).includes(filePath)
  }),
  readdirSync: (dirPath: string, options?: {withFileTypes?: boolean}) => {
    const folder = mockFileSystem[dirPath]
    if (!folder) return []

    if (options?.withFileTypes) {
      return Object.keys(folder).map((name) => ({
        name,
        isDirectory: () => false,
        isFile: () => true
      }))
    }
    return Object.keys(folder)
  }
}))

describe('Special Folders', () => {
  const mockPluginInterface: PluginInterface = {
    manifestPath: mockManifestPath,
    browser: 'chrome'
  }

  describe('scanFilesInFolder', () => {
    it('returns empty array for non-existent directory', () => {
      const result = scanFilesInFolder('/non/existent/path', () => true)
      expect(result).toEqual([])
    })

    it('returns empty array for non-directory path', () => {
      const result = scanFilesInFolder(
        path.join(mockContext, 'public', 'image1.png'),
        () => true
      )
      expect(result).toEqual([])
    })

    it('scans all files when filter is always true', () => {
      const result = scanFilesInFolder(
        path.join(mockContext, 'public'),
        () => true
      )
      expect(result).toEqual([
        path.join(mockContext, 'public', 'image1.png'),
        path.join(mockContext, 'public', 'image2.jpg'),
        path.join(mockContext, 'public', 'style.css')
      ])
    })

    it('filters files based on provided filter function', () => {
      const result = scanFilesInFolder(
        path.join(mockContext, 'pages'),
        (name) => name.endsWith('.html')
      )
      expect(result).toEqual([
        path.join(mockContext, 'pages', 'index.html'),
        path.join(mockContext, 'pages', 'about.html'),
        path.join(mockContext, 'pages', 'contact.html')
      ])
    })
  })

  describe('generateEntries', () => {
    it('returns empty object for empty includes', () => {
      const result = generateEntries(mockContext, [])
      expect(result).toEqual({})
    })

    it('returns empty object for undefined includes', () => {
      const result = generateEntries(mockContext, undefined)
      expect(result).toEqual({})
    })

    it('generates entries without folder name', () => {
      const includes = [
        path.join(mockContext, 'public', 'image1.png'),
        path.join(mockContext, 'public', 'image2.jpg')
      ]
      const result = generateEntries(mockContext, includes)
      expect(result).toEqual({
        'public/image1.png': path.join(mockContext, 'public', 'image1.png'),
        'public/image2.jpg': path.join(mockContext, 'public', 'image2.jpg')
      })
    })

    it('generates entries with folder name', () => {
      const includes = [
        path.join(mockContext, 'pages', 'index.html'),
        path.join(mockContext, 'pages', 'about.html')
      ]
      const result = generateEntries(mockContext, includes, 'pages')
      expect(result).toEqual({
        'pages/index': path.join(mockContext, 'pages', 'index.html'),
        'pages/about': path.join(mockContext, 'pages', 'about.html')
      })
    })
  })

  describe('getSpecialFoldersData', () => {
    it('generates entries for all special folders', () => {
      const result = getSpecialFoldersData(mockPluginInterface)

      expect(result).toEqual({
        public: {
          'public/image1.png': path.join(mockContext, 'public', 'image1.png'),
          'public/image2.jpg': path.join(mockContext, 'public', 'image2.jpg'),
          'public/style.css': path.join(mockContext, 'public', 'style.css')
        },
        pages: {
          'pages/index': path.join(mockContext, 'pages', 'index.html'),
          'pages/about': path.join(mockContext, 'pages', 'about.html'),
          'pages/contact': path.join(mockContext, 'pages', 'contact.html')
        },
        scripts: {
          'scripts/main': path.join(mockContext, 'scripts', 'main.js'),
          'scripts/utils': path.join(mockContext, 'scripts', 'utils.ts'),
          'scripts/component': path.join(
            mockContext,
            'scripts',
            'component.tsx'
          )
        }
      })
    })
  })
})
