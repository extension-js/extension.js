import fs from 'fs'
import * as utils from '../../helpers/utils'

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
})
