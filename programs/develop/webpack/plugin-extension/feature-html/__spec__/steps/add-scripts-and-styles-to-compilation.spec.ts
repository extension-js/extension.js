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

  it('should handle invalid HTML content', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with null/undefined values
    getAssetsFromHtmlSpy.mockReturnValue(null)

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: []
      }
    })
  })

  it('should handle empty asset lists', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with empty arrays
    getAssetsFromHtmlSpy.mockReturnValue({
      js: [],
      css: [],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: []
      }
    })
  })

  it('should handle absolute paths in assets', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with absolute paths
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['/js/script.js'],
      css: ['/css/style.css'],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['/js/script.js', '/css/style.css']
      }
    })
  })

  it('should handle paths with query parameters and hash fragments', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with query parameters and hash fragments
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script.js?v=123#hash'],
      css: ['style.css?v=456#fragment'],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['script.js?v=123#hash', 'style.css?v=456#fragment']
      }
    })
  })

  it('should handle multiple HMR scripts in development mode', () => {
    const includeList: FilepathList = {
      feature1: 'resource1.html',
      feature2: 'resource2.html'
    }
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Set development mode
    compiler.options.mode = 'development'

    // Mock HTML assets for multiple features
    getAssetsFromHtmlSpy.mockImplementation((resource: string) => {
      if (resource === 'resource1.html') {
        return {
          js: ['script1.js'],
          css: ['style1.css'],
          static: []
        }
      }
      return {
        js: ['script2.js'],
        css: ['style2.css'],
        static: []
      }
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature1: {
        import: ['script1.js', 'style1.css', 'minimum-script-file']
      },
      feature2: {
        import: ['script2.js', 'style2.css', 'minimum-script-file']
      }
    })
  })

  it('should handle HMR script path resolution', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Set development mode
    compiler.options.mode = 'development'

    // Mock path resolution for HMR script
    vi.spyOn(path, 'resolve').mockImplementation((...args) => {
      if (args[args.length - 1] === 'minimum-script-file') {
        return '/absolute/path/to/minimum-script-file'
      }
      return args.join('/')
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
        import: [
          'script.js',
          'style.css',
          '/absolute/path/to/minimum-script-file'
        ]
      }
    })
  })

  it('should handle excluded resources in development mode', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const excludeList: FilepathList = {excluded: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList,
      excludeList
    })

    // Set development mode
    compiler.options.mode = 'development'

    // Mock HTML assets
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script.js'],
      css: ['style.css'],
      static: []
    })

    // Mock shouldExclude to exclude the resource
    shouldExcludeSpy.mockReturnValue(true)

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({})
  })

  it('should handle invalid file paths in assets', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with invalid paths
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['../../../invalid.js'],
      css: ['../../../invalid.css'],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['../../../invalid.js', '../../../invalid.css']
      }
    })
  })

  it('should handle missing HMR script file', () => {
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

  it('should handle empty includeList', () => {
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList: {}
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({})
  })

  it('should handle assets with query parameters', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with query parameters
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script.js?v=123'],
      css: ['style.css?v=456'],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['script.js?v=123', 'style.css?v=456']
      }
    })
  })

  it('should handle assets with hash fragments', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with hash fragments
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script.js#hash'],
      css: ['style.css#hash'],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['script.js#hash', 'style.css#hash']
      }
    })
  })

  it('should handle assets with special characters in filenames', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with special characters
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script with spaces.js'],
      css: ['style with spaces.css'],
      static: []
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['script with spaces.js', 'style with spaces.css']
      }
    })
  })

  it('should handle circular dependencies in assets', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new AddScriptsAndStylesToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML assets with circular dependencies
    getAssetsFromHtmlSpy.mockReturnValue({
      js: ['script1.js', 'script2.js'],
      css: ['style1.css', 'style2.css'],
      static: []
    })

    // Mock shouldExclude to create circular dependency
    shouldExcludeSpy.mockImplementation((filePath: string) => {
      return filePath === 'script2.js' || filePath === 'style2.css'
    })

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['script1.js', 'style1.css']
      }
    })
  })

  it('should handle compilation errors', () => {
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

    // Add error to compiler
    compiler.errors = ['Some error']

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      feature: {
        import: ['script.js', 'style.css']
      }
    })
  })
})
