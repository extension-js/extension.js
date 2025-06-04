import {describe, it, expect, vi, beforeEach} from 'vitest'
import {AddToFileDependencies} from '../../steps/add-to-file-dependencies'
import * as fs from 'fs'
import * as path from 'path'
import * as utils from '../../html-lib/utils'
import {type FilepathList} from '../../../../webpack-types'

vi.mock('fs')
vi.mock('path')
vi.mock('../../html-lib/utils')

describe('AddToFileDependencies', () => {
  let compiler: any
  let compilation: any
  let existsSyncSpy: any
  let getAssetsFromHtmlSpy: any
  let fileDependencies: Set<string>
  let resolveSpy: any
  let dirnameSpy: any

  beforeEach(() => {
    vi.clearAllMocks()

    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    getAssetsFromHtmlSpy = vi.spyOn(utils, 'getAssetsFromHtml')
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

  it('should add HTML file to file dependencies', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets
    getAssetsFromHtmlSpy.mockReturnValue({
      js: [],
      css: [],
      static: ['static/image.png', 'static/style.css']
    })

    // Mock existsSync to return true for all files
    existsSyncSpy.mockImplementation((filePath: string) => true)

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual(['resource.html'])
  })

  it('should not add dependencies if file does not exist', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
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
    const includeList: FilepathList = {feature: undefined}
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual([])
  })

  it('should not add dependencies if compilation has errors', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    // Set compilation errors
    compilation.errors = ['Some error']

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual([])
  })

  it('should handle multiple entries in includeList', () => {
    const includeList: FilepathList = {
      feature1: 'resource1.html',
      feature2: 'resource2.html'
    }
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets for each resource
    getAssetsFromHtmlSpy
      .mockReturnValueOnce({
        js: [],
        css: [],
        static: ['static/image1.png']
      })
      .mockReturnValueOnce({
        js: [],
        css: [],
        static: ['static/image2.png']
      })

    // Mock existsSync to return true for all files
    existsSyncSpy.mockImplementation((filePath: string) => true)

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual([
      'resource1.html',
      'resource2.html'
    ])
  })

  it('should not add duplicate dependencies', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddToFileDependencies({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with duplicate static files
    getAssetsFromHtmlSpy.mockReturnValue({
      js: [],
      css: [],
      static: ['static/image.png', 'static/image.png']
    })

    // Mock existsSync to return true for all files
    existsSyncSpy.mockImplementation((filePath: string) => true)

    plugin.apply(compiler)

    expect(Array.from(fileDependencies)).toEqual(['resource.html'])
  })
})
