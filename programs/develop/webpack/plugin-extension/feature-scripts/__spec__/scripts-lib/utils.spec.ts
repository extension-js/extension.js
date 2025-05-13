import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {FilepathList} from '../../../../webpack-types'
import {getScriptEntries, getCssEntries} from '../../scripts-lib/utils'

const testDir = path.join(__dirname, 'test-assets')
const excludeList: FilepathList = {
  fileA: path.join(testDir, 'theme.scss'),
  fileB: path.join(testDir, 'script2.js')
}

beforeAll(() => {
  // Set up test files in the test directory
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir)
  }

  const files = [
    'script1.js',
    'script2.js',
    'style.css',
    'theme.scss',
    'main.less',
    'file.js'
  ]

  files.forEach((file) => {
    const filePath = path.join(testDir, file)
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '')
    }
  })
})

afterAll(() => {
  // Clean up the test directory after the tests run
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, {recursive: true, force: true})
  }
})

describe('File Utilities', () => {
  describe('getScriptEntries', () => {
    it('returns script entries excluding the ones in the exclude list', () => {
      const scriptEntries = getScriptEntries(
        [path.join(testDir, 'script1.js'), path.join(testDir, 'script2.js')],
        excludeList
      )

      expect(scriptEntries).toEqual([path.join(testDir, 'script1.js')])
    })

    it('returns an empty array if no valid script entries exist', () => {
      const scriptEntries = getScriptEntries(
        [path.join(testDir, 'script2.js')],
        excludeList
      )
      expect(scriptEntries).toEqual([])
    })

    it('filters out excluded script entries', () => {
      const scriptEntries = getScriptEntries(
        [path.join(testDir, 'script2.js')],
        excludeList
      )
      expect(scriptEntries).toEqual([])
    })
  })

  describe('getCssEntries', () => {
    it('returns CSS entries excluding the ones in the exclude list', () => {
      const cssEntries = getCssEntries(
        [
          path.join(testDir, 'style.css'),
          path.join(testDir, 'theme.scss'),
          path.join(testDir, 'main.less')
        ],
        excludeList
      )
      expect(cssEntries).toEqual([
        path.join(testDir, 'style.css'),
        path.join(testDir, 'main.less')
      ])
    })

    it('returns an empty array if no valid CSS entries exist', () => {
      const cssEntries = getCssEntries(
        [path.join(testDir, 'theme.scss')],
        excludeList
      )
      expect(cssEntries).toEqual([])
    })

    it('filters out excluded CSS entries', () => {
      const cssEntries = getCssEntries(
        [path.join(testDir, 'theme.scss')],
        excludeList
      )
      expect(cssEntries).toEqual([])
    })
  })
})
