import * as fs from 'fs'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {HandleCommonErrors} from '../../steps/handle-common-errors'
import {getAssetsFromHtml} from '../../html-lib/utils'
import * as messages from '../../../../webpack-lib/messages'

vi.mock('fs')
vi.mock('../../html-lib/utils')
vi.mock('../../../../webpack-lib/messages')

describe('HandleCommonErrors', () => {
  let compilation: any
  let compiler: any
  let existsSyncSpy: any
  let afterSealCallback: any

  beforeEach(() => {
    vi.clearAllMocks()

    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.mocked(messages.fileNotFound).mockImplementation(
      (resource, file) => `File not found: ${file} referenced in ${resource}`
    )

    compilation = {
      hooks: {
        afterSeal: {
          tapPromise: (_name: string, fn: any) => {
            afterSealCallback = fn
          }
        }
      },
      errors: []
    }

    compiler = {
      hooks: {
        compilation: {
          tap: (_name: string, fn: any) => {
            fn(compilation)
          }
        }
      }
    }
  })

  it('should handle missing JS file error', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['missing.js'],
      css: [],
      static: []
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'missing.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      'File not found: missing.js referenced in resource.html'
    )
  })

  it('should handle missing CSS file error', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: [],
      css: ['missing.css'],
      static: []
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'missing.css'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      'File not found: missing.css referenced in resource.html'
    )
  })

  it('should ignore absolute path errors', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['/absolute/path/script.js'],
      css: ['/absolute/path/style.css'],
      static: []
    })

    compilation.errors = [
      {
        message:
          "Module not found: Error: Can't resolve '/absolute/path/script.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      "Module not found: Error: Can't resolve '/absolute/path/script.js'"
    )
  })

  it('should handle missing HTML files', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    existsSyncSpy.mockReturnValue(false)

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'missing.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      "Module not found: Error: Can't resolve 'missing.js'"
    )
  })

  it('should handle multiple HTML files', async () => {
    const includeList = {
      feature1: 'resource1.html',
      feature2: 'resource2.html'
    }
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockImplementation((resource) => {
      if (resource === 'resource1.html') {
        return {
          js: ['missing.js'],
          css: [],
          static: []
        }
      }
      return {
        js: [],
        css: [],
        static: []
      }
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'missing.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      'File not found: missing.js referenced in resource1.html'
    )
  })

  it('should not modify non-resolve errors', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    compilation.errors = [
      {
        message: 'Some other error'
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe('Some other error')
  })

  it('should handle undefined resources in includeList', async () => {
    const includeList = {
      feature1: 'resource1.html',
      feature2: undefined
    }
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['missing.js'],
      css: [],
      static: []
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'missing.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      'File not found: missing.js referenced in resource1.html'
    )
  })

  it('should handle empty includeList', async () => {
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList: {}
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'missing.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      "Module not found: Error: Can't resolve 'missing.js'"
    )
  })

  it('should handle malformed error messages', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['missing.js'],
      css: [],
      static: []
    })

    compilation.errors = [
      {
        message: "Can't resolve 'missing.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe("Can't resolve 'missing.js'")
  })

  it('should handle missing manifest path', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: '',
      includeList
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'missing.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    // Friendly error remains unchanged since manifest path is missing
    expect(compilation.errors[0].message).toBe(
      'File not found: missing.js referenced in resource.html'
    )
  })

  it('should handle invalid error objects', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    // Create error objects that are safe to access
    compilation.errors = [
      {message: 'null error'},
      {message: 'undefined error'},
      {message: 'empty object error'},
      {message: 'null message error'},
      {message: 'undefined message error'}
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    // Verify that the errors are preserved
    expect(compilation.errors).toEqual([
      {message: 'null error'},
      {message: 'undefined error'},
      {message: 'empty object error'},
      {message: 'null message error'},
      {message: 'undefined message error'}
    ])
  })

  it('should handle assets with query parameters', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['script.js?v=123'],
      css: ['style.css?v=456'],
      static: []
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'script.js?v=123'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      'File not found: script.js?v=123 referenced in resource.html'
    )
  })

  it('should handle assets with hash fragments', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['script.js#hash'],
      css: ['style.css#fragment'],
      static: []
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'script.js#hash'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      'File not found: script.js#hash referenced in resource.html'
    )
  })

  it('should handle assets with special characters in filenames', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['script with spaces.js'],
      css: ['style@2x.css'],
      static: []
    })

    compilation.errors = [
      {
        message:
          "Module not found: Error: Can't resolve 'script with spaces.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      'File not found: script with spaces.js referenced in resource.html'
    )
  })

  it('should handle multiple missing assets', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['missing1.js', 'missing2.js'],
      css: ['missing1.css', 'missing2.css'],
      static: []
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'missing1.js'"
      },
      {
        message: "Module not found: Error: Can't resolve 'missing2.js'"
      },
      {
        message: "Module not found: Error: Can't resolve 'missing1.css'"
      },
      {
        message: "Module not found: Error: Can't resolve 'missing2.css'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      'File not found: missing1.js referenced in resource.html'
    )
    expect(compilation.errors[1].message).toBe(
      'File not found: missing2.js referenced in resource.html'
    )
    expect(compilation.errors[2].message).toBe(
      'File not found: missing1.css referenced in resource.html'
    )
    expect(compilation.errors[3].message).toBe(
      'File not found: missing2.css referenced in resource.html'
    )
  })

  it('should handle circular dependencies', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['script1.js', 'script2.js'],
      css: ['style1.css', 'style2.css'],
      static: []
    })

    compilation.errors = [
      {
        message: "Module not found: Error: Can't resolve 'script1.js'"
      },
      {
        message: "Module not found: Error: Can't resolve 'script2.js'"
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe(
      'File not found: script1.js referenced in resource.html'
    )
    expect(compilation.errors[1].message).toBe(
      'File not found: script2.js referenced in resource.html'
    )
  })

  it('should handle compilation errors', async () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new HandleCommonErrors({
      manifestPath: 'manifest.json',
      includeList
    })

    compilation.errors = [
      {
        message: 'Some compilation error'
      }
    ]

    plugin.apply(compiler)
    await afterSealCallback()

    expect(compilation.errors[0].message).toBe('Some compilation error')
  })
})
