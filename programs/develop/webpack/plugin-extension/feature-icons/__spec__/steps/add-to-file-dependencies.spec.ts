import {describe, it, expect, vi, beforeEach} from 'vitest'
import {AddToFileDependencies} from '../../steps/add-to-file-dependencies'
import * as fs from 'fs'
import * as path from 'path'
import {type FilepathList} from '../../../../webpack-types'

vi.mock('fs')
vi.mock('path')

describe('AddToFileDependencies', () => {
  let compiler: any
  let compilation: any
  let existsSyncSpy: any
  let fileDependencies: Set<string>
  let resolveSpy: any
  let dirnameSpy: any

  beforeEach(() => {
    vi.clearAllMocks()

    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    resolveSpy = vi
      .spyOn(path, 'resolve')
      .mockImplementation((...args) => args.join('/'))
    dirnameSpy = vi.spyOn(path, 'dirname').mockImplementation((filePath) => {
      // Return the directory part of the path
      const parts = filePath.split('/')
      parts.pop()
      return parts.join('/')
    })

    // Create a real Set for fileDependencies
    fileDependencies = new Set()

    // Mock compilation object with proper Set methods
    compilation = {
      errors: [],
      fileDependencies,
      hooks: {
        processAssets: {
          tap: vi.fn((options, callback) => {
            callback()
          })
        }
      }
    }

    // Mock compiler object
    compiler = {
      hooks: {
        thisCompilation: {
          tap: vi.fn((name, callback) => {
            callback(compilation)
          })
        }
      }
    }
  })

  it('should add icon files to file dependencies', () => {
    const includeList: FilepathList = {
      browser_action: 'icon.png',
      page_action: 'page_icon.png'
    }
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock existsSync to return true for all files
    existsSyncSpy.mockImplementation((filePath: string) => true)

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual(['icon.png', 'page_icon.png'])
  })

  it('should not add dependencies if file does not exist', () => {
    const includeList: FilepathList = {
      browser_action: 'icon.png'
    }
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock file does not exist
    existsSyncSpy.mockReturnValue(false)

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual([])
  })

  it('should handle undefined resources from manifest', () => {
    const includeList: FilepathList = {
      browser_action: undefined
    }
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual([])
  })

  it('should not add dependencies if compilation has errors', () => {
    const includeList: FilepathList = {
      browser_action: 'icon.png'
    }
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    // Set compilation errors
    compilation.errors = ['Some error']

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual([])
  })

  it('should handle array of resources', () => {
    const includeList: FilepathList = {
      browser_action: ['icon16.png', 'icon32.png', 'icon48.png']
    }
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock existsSync to return true for all files
    existsSyncSpy.mockImplementation((filePath: string) => true)

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual([
      'icon16.png',
      'icon32.png',
      'icon48.png'
    ])
  })

  it('should not add duplicate dependencies', () => {
    const includeList: FilepathList = {
      browser_action: 'icon.png',
      page_action: 'icon.png'
    }
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock existsSync to return true for all files
    existsSyncSpy.mockImplementation((filePath: string) => true)

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual(['icon.png'])
  })
})
