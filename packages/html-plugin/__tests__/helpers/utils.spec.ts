import fs from 'fs'
import * as utils from '../../helpers/utils'
import {IncludeList} from '../../types'

jest.mock('fs')

describe('fileUtils', () => {
  describe('isUsingReact', () => {
    it('returns false if package.json does not exist', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValueOnce(false)
      expect(utils.isUsingReact('/project/dir')).toBe(false)
    })

    it('returns true if React is a dependency', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValueOnce(true)
      jest.doMock(
        '/project/dir/package.json',
        () => ({
          dependencies: {react: '^17.0.0'}
        }),
        {virtual: true}
      )

      expect(utils.isUsingReact('/project/dir')).toBe(true)
    })

    it('returns true if React is a devDependency', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValueOnce(true)
      jest.doMock(
        '/project/dir/package.json',
        () => ({
          devDependencies: {react: '^17.0.0'}
        }),
        {virtual: true}
      )

      expect(utils.isUsingReact('/project/dir')).toBe(true)
    })
  })

  describe('shouldExclude', () => {
    it('returns true if path matches an ignore pattern', () => {
      const ignorePatterns = ['node_modules', 'dist']
      expect(
        utils.shouldExclude('/project/dir/node_modules/package', ignorePatterns)
      ).toBe(true)
    })

    it('returns false if path does not match any ignore pattern', () => {
      const ignorePatterns = ['node_modules', 'dist']
      expect(
        utils.shouldExclude('/project/dir/src/index.js', ignorePatterns)
      ).toBe(false)
    })
  })

  describe('getResolvedPath', () => {
    it('returns a resolved public path for a given file path', () => {
      const context = '/project/dir'
      const filePath = '/project/dir/src/index.js'
      const basePath = 'public'

      expect(utils.getResolvedPath(context, filePath, basePath)).toEqual(
        '/public/src/index.js'
      )
    })
  })

  describe('isFromIncludeList', () => {
    it('returns true for an asset that is part of the entry list', () => {
      const mockIncludeList: IncludeList = {
        'pages/main.html': {
          html: './pages/main-file.html',
          css: [],
          js: [],
          static: []
        },
        'sandbox/page-0.html': {
          html: 'sandboxed-frame.html',
          css: [],
          js: [],
          static: []
        }
      }
      const result = utils.isFromIncludeList(
        mockIncludeList,
        'sandboxed-frame.html'
      )
      expect(result).toBe(true)
    })

    it('returns false for an asset not part of the entry list', () => {
      const mockIncludeList: IncludeList = {
        'pages/main.html': {
          html: './pages/main-file.html',
          css: [],
          js: [],
          static: []
        },
        'sandbox/page-0.html': {
          html: 'sandboxed-frame.html',
          css: [],
          js: [],
          static: []
        }
      }
      const result = utils.isFromIncludeList(
        mockIncludeList,
        'sandboxed-frame2.html'
      )
      expect(result).toBe(false)
    })
  })

  describe('getIncludeEntry', () => {
    it('retrieves the entry name for a given file path', () => {
      const mockIncludeList: IncludeList = {
        'pages/main.html': {
          html: './pages/main-file.html',
          css: [],
          js: [],
          static: []
        },
        'sandbox/page-0.html': {
          html: 'sandboxed-frame.html',
          css: [],
          js: [],
          static: []
        }
      }
      const entryName = utils.getIncludeEntry(
        mockIncludeList,
        'sandboxed-frame.html',
        '.html'
      )
      expect(entryName).toEqual('/sandbox/page-0.html')
    })

    it('returns the filepath if the file path does not match an entry', () => {
      const mockIncludeList: IncludeList = {
        'pages/main.html': {
          html: './pages/main-file.html',
          css: [],
          js: [],
          static: []
        },
        'sandbox/page-0.html': {
          html: 'sandboxed-frame.html',
          css: [],
          js: [],
          static: []
        }
      }
      const entryName = utils.getIncludeEntry(
        mockIncludeList,
        'sandboxed-frame2.html',
        '.html'
      )
      expect(entryName).toEqual('sandboxed-frame2.html')
    })
  })
})
