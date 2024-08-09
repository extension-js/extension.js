import fs from 'fs'
import {
  getScriptEntries,
  getCssEntries,
  getRelativePath
} from '../../scripts-lib/utils'

jest.mock('fs')
jest.mock('../../../lib/utils')

const excludeList = {
  fileA: 'script2.js',
  fileB: 'script3.js'
}

describe('File Utilities', () => {
  describe('getScriptEntries', () => {
    it('returns script entries excluding the ones in the exclude list', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)

      const scriptEntries = getScriptEntries(
        ['script1.js', 'script2.js'],
        excludeList
      )
      expect(scriptEntries).toEqual(['script1.js'])
    })

    it('returns an empty array if no valid script entries exist', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const scriptEntries = getScriptEntries(
        ['script1.js', 'script2.js'],
        excludeList
      )
      expect(scriptEntries).toEqual([])
    })

    it('filters out excluded script entries', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)

      const scriptEntries = getScriptEntries(
        ['script1.js', 'script2.js'],
        excludeList
      )
      expect(scriptEntries).toEqual([])
    })
  })

  describe('getCssEntries', () => {
    it('returns CSS entries excluding the ones in the exclude list', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)

      const cssEntries = getCssEntries(
        ['style.css', 'theme.scss', 'main.less'],
        excludeList
      )
      expect(cssEntries).toEqual(['style.css', 'main.less'])
    })

    it('returns an empty array if no valid CSS entries exist', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const cssEntries = getCssEntries(['style.css', 'theme.scss'], excludeList)
      expect(cssEntries).toEqual([])
    })

    it('filters out excluded CSS entries', () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      excludeList

      const cssEntries = getCssEntries(['style.css', 'theme.scss'], excludeList)
      expect(cssEntries).toEqual([])
    })
  })

  describe('getRelativePath', () => {
    it('returns the correct relative path', () => {
      const from = '/project/dir/src/index.js'
      const to = '/project/dir/dist/file.js'
      const relativePath = getRelativePath(from, to)
      expect(relativePath).toBe('../dist/file.js')
    })

    it('returns the correct relative path with ./ prefix', () => {
      const from = '/project/dir/src'
      const to = '/project/dir/src/file.js'
      const relativePath = getRelativePath(from, to)
      expect(relativePath).toBe('./file.js')
    })
  })
})
