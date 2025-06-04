import * as fs from 'fs'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {HandleCommonErrors} from '../../steps/handle-common-errors'
import {getAssetsFromHtml} from '../../html-lib/utils'
import * as messages from '../../../../lib/messages'

vi.mock('fs')
vi.mock('../../html-lib/utils')
vi.mock('../../../../lib/messages')

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
})
