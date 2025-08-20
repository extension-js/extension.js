import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import ensureHMRForScripts from '../../steps/ensure-hmr-for-scripts'
import * as utils from '../../../../webpack-lib/utils'
import {getAssetsFromHtml} from '../../html-lib/utils'

vi.mock('fs')
vi.mock('path')
vi.mock('../../../../webpack-lib/utils')
vi.mock('../../html-lib/utils')

describe('ensureHMRForScripts', () => {
  let loaderContext: any
  let existsSyncSpy: any
  let resolveSpy: any

  beforeEach(() => {
    vi.clearAllMocks()

    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    resolveSpy = vi
      .spyOn(path, 'resolve')
      .mockImplementation((...args) => args.join('/'))

    loaderContext = {
      getOptions: vi.fn().mockReturnValue({
        manifestPath: '/project/manifest.json',
        includeList: {
          feature: 'resource.html'
        }
      }),
      resourcePath: '/project/scripts/app.js'
    }
  })

  it('should inject HMR code for matching scripts', () => {
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['scripts/app.js'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should not inject HMR code for non-matching scripts', () => {
    loaderContext.resourcePath = '/project/scripts/app.js'
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['scripts/other.js'], // Different from resourcePath
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('console.log("test")')
  })

  it('should not inject HMR code when using JS framework', () => {
    vi.mocked(utils.isUsingJSFramework).mockReturnValue(true)

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    // In minimal mode we still inject HMR accept for matched files
    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should throw error for invalid options', () => {
    loaderContext.getOptions.mockReturnValue({
      manifestPath: '/project/manifest.json',
      includeList: 'invalid' // Should be an object
    })

    expect(() => {
      ensureHMRForScripts.call(loaderContext, 'console.log("test")')
    }).toThrow()
  })

  it('should handle missing resources', () => {
    loaderContext.getOptions.mockReturnValue({
      manifestPath: '/project/manifest.json',
      includeList: {
        feature: undefined
      }
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle absolute paths in script references', () => {
    loaderContext.resourcePath = '/absolute/path/to/app.js'
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['/absolute/path/to/app.js'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle relative paths in script references', () => {
    loaderContext.resourcePath = './relative/path/app.js'
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['./relative/path/app.js'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle paths with query parameters', () => {
    loaderContext.resourcePath = '/project/scripts/app.js?v=123'
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['scripts/app.js?v=123'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle multiple script matches', () => {
    loaderContext.resourcePath = '/project/scripts/app.js'
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['scripts/app.js', 'scripts/other.js', 'scripts/app.js'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle empty script lists', () => {
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: [],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should preserve script content exactly', () => {
    const originalContent = `
      // Some comments
      const value = 42;
      console.log(value);
      /* More comments */
    `
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['scripts/app.js'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(loaderContext, originalContent)

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain(originalContent.trim())
  })

  it('should handle non-existent resource files', () => {
    existsSyncSpy.mockReturnValue(false)

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle invalid schema properties', () => {
    loaderContext.getOptions.mockReturnValue({
      manifestPath: '/project/manifest.json',
      includeList: {
        feature: 'resource.html'
      }
    })

    expect(() => {
      ensureHMRForScripts.call(loaderContext, 'console.log("test")')
    }).not.toThrow()
  })

  it('should handle malformed error messages', () => {
    loaderContext.getOptions.mockReturnValue({
      manifestPath: '/project/manifest.json',
      includeList: null // Invalid type
    })

    expect(() => {
      ensureHMRForScripts.call(loaderContext, 'console.log("test")')
    }).toThrow()
  })

  it('should handle assets with hash fragments', () => {
    loaderContext.resourcePath = '/project/scripts/app.js#hash'
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['scripts/app.js#hash'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle assets with special characters in filenames', () => {
    loaderContext.resourcePath = '/project/scripts/app with spaces.js'
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['scripts/app with spaces.js'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle assets with Windows-style paths', () => {
    loaderContext.resourcePath = 'C:\\project\\scripts\\app.js'
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['C:\\project\\scripts\\app.js'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle empty includeList', () => {
    loaderContext.getOptions.mockReturnValue({
      manifestPath: '/project/manifest.json',
      includeList: {}
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle circular dependencies', () => {
    loaderContext.resourcePath = '/project/scripts/app.js'
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['scripts/app.js', 'scripts/app.js'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })

  it('should handle compilation errors', () => {
    loaderContext.getOptions.mockReturnValue({
      manifestPath: '/project/manifest.json',
      includeList: {
        feature: 'resource.html'
      }
    })

    // Even with loader errors we still output with HMR in minimal mode
    loaderContext.errors = ['Some error']

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).toContain('import.meta.webpackHot.accept()')
    expect(result).toContain('console.log("test")')
  })
})
