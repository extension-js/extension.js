import {describe, it, expect, vi, beforeEach} from 'vitest'
import {AddScriptsAndStylesToCompilation} from '../../steps/add-scripts-and-styles-to-compilation'
import * as fs from 'fs'
import * as path from 'path'
import * as utils from '../../html-lib/utils'
import * as webpackUtils from '../../../../lib/utils'
import {type FilepathList} from '../../../../webpack-types'

vi.mock('fs')
vi.mock('path')
vi.mock('../../html-lib/utils')
vi.mock('../../../../lib/utils', () => ({
  shouldExclude: vi
    .fn()
    .mockImplementation(
      (filePath: string, ignorePatterns: FilepathList) => false
    )
}))

describe('AddScriptsAndStylesToCompilation', () => {
  let compiler: any
  let existsSyncSpy: any
  let getAssetsFromHtmlSpy: any
  let shouldExcludeSpy: any

  beforeEach(() => {
    vi.clearAllMocks()

    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    getAssetsFromHtmlSpy = vi.spyOn(utils, 'getAssetsFromHtml')
    shouldExcludeSpy = vi
      .spyOn(webpackUtils, 'shouldExclude')
      .mockReturnValue(false)

    // Mock path.resolve to return relative paths for HMR script
    vi.spyOn(path, 'resolve').mockImplementation((...args) => {
      // If the last argument is 'minimum-script-file', return it as is
      if (args[args.length - 1] === 'minimum-script-file') {
        return 'minimum-script-file'
      }
      // Otherwise join with forward slashes
      return args.join('/')
    })

    compiler = {
      options: {
        mode: 'production',
        entry: {}
      }
    }
  })

  it('should add JS and CSS assets to compilation entry', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script.js'],
      css: ['style.css'],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['script.js', 'style.css']
      }
    })
  })

  it('should add HMR script in development mode', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Set development mode
    compiler.options.mode = 'development'

    // Mock HTML assets
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script.js'],
      css: ['style.css'],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['script.js', 'style.css', 'minimum-script-file']
      }
    })
  })

  it('should exclude assets that match excludeList', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const excludeList: FilepathList = {excluded: 'excluded.js'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList,
      excludeList
    })

    // Mock HTML assets
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script.js', 'excluded.js'],
      css: ['style.css'],
      static: []
    })

    // Mock shouldExclude to exclude specific files
    shouldExcludeSpy.mockImplementation(
      (filePath: string) => filePath === 'excluded.js'
    )

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['script.js', 'style.css']
      }
    })
  })

  it('should not modify entry if resource does not exist', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock file does not exist
    existsSyncSpy.mockReturnValue(false)

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({})
  })

  it('should handle undefined resources from manifest', () => {
    const includeList: FilepathList = {feature: undefined}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({})
  })

  it('should preserve existing entries when adding new ones', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Set existing entry
    compiler.options.entry = {
      existing: {
        import: ['existing.js']
      }
    }

    // Mock HTML assets
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script.js'],
      css: ['style.css'],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      existing: {
        import: ['existing.js']
      },
      feature: {
        import: ['script.js', 'style.css']
      }
    })
  })
})
