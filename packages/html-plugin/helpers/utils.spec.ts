import fs from 'fs'
// @ts-ignore
import parse5utils from 'parse5-utils'
import * as utils from './utils'

jest.mock('fs')

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
      parse5utils.shouldExclude(
        '/project/dir/node_modules/package',
        ignorePatterns
      )
    ).toBe(true)
  })

  it('returns false if path does not match any ignore pattern', () => {
    const ignorePatterns = ['node_modules', 'dist']
    expect(
      parse5utils.shouldExclude('/project/dir/src/index.js', ignorePatterns)
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

describe('isCompilationEntry', () => {
  it('returns true for an asset that is part of the compilation entries', () => {
    const mockCompilation: any = {
      compiler: {context: '/project'},
      assets: {'src/index.js': {}}
    }
    const result = parse5utils.isCompilationEntry(
      mockCompilation,
      '/project/src/index.js'
    )
    expect(result).toBe(true)
  })

  it('returns false for an asset not part of the compilation entries', () => {
    const mockCompilation: any = {
      compiler: {context: '/project'},
      assets: {'src/index.js': {}}
    }
    const result = parse5utils.isCompilationEntry(
      mockCompilation,
      '/project/src/other.js'
    )
    expect(result).toBe(false)
  })
})

describe('getCompilationEntryName', () => {
  it('retrieves the entry name for a given file path', () => {
    const mockCompilation: any = {
      compiler: {context: '/project'},
      assets: {'src/index.js': {}}
    }
    const entryName = parse5utils.getCompilationEntryName(
      mockCompilation,
      '/project/src/index.js'
    )
    expect(entryName).toEqual('src/index.js')
  })

  it('returns an empty string if the file path does not match an entry', () => {
    const mockCompilation: any = {
      compiler: {context: '/project'},
      assets: {'src/index.js': {}}
    }
    const entryName = parse5utils.getCompilationEntryName(
      mockCompilation,
      '/project/src/other.js'
    )
    expect(entryName).toEqual('')
  })
})
