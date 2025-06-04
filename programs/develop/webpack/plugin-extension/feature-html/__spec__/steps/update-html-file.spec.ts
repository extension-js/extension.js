import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {UpdateHtmlFile} from '../../steps/update-html-file'
import * as utils from '../../../../lib/utils'
import * as messages from '../../../../lib/messages'
import {sources} from '@rspack/core'
import * as patchHtml from '../../html-lib/patch-html'

vi.mock('fs')
vi.mock('path')
vi.mock('../../html-lib/patch-html')
vi.mock('../../../../lib/utils')
vi.mock('../../../../lib/messages')

describe('UpdateHtmlFile', () => {
  let compilation: any
  let compiler: any
  let consoleErrorSpy: any
  let processExitSpy: any

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error')
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)

    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('html content')
    vi.mocked(utils.filterKeysForThisBrowser).mockReturnValue({
      name: 'Test Extension'
    })
    vi.mocked(messages.manifestFieldError).mockReturnValue(
      'Manifest error message'
    )
    vi.mocked(utils.shouldExclude).mockReturnValue(false)
    vi.mocked(patchHtml.patchHtml).mockReturnValue('patched html content')

    // Mock path module functions
    vi.mocked(path.resolve).mockImplementation((...args) => {
      return args.join('/').replace(/\\/g, '/')
    })
    vi.mocked(path.join).mockImplementation((...args) => {
      return args.join('/').replace(/\\/g, '/')
    })
    vi.mocked(path.dirname).mockImplementation((p) => {
      return p.split('/').slice(0, -1).join('/')
    })
    vi.mocked(path.basename).mockImplementation((p) => {
      return p.split('/').pop() || ''
    })
    vi.mocked(path.normalize).mockImplementation((p) => {
      return p.replace(/\\/g, '/')
    })

    compilation = {
      hooks: {
        processAssets: {
          tap: (_options: any, fn: any) => {
            fn()
          }
        }
      },
      assets: new Map(),
      getAssetPath: (name: string) => name,
      updateAsset: vi.fn(),
      errors: [],
      options: {
        mode: 'development'
      }
    }

    compiler = {
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: any) => {
            fn(compilation)
          }
        }
      }
    }
  })

  it('should update HTML file with patched content', () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new UpdateHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(patchHtml.patchHtml).toHaveBeenCalledWith(
      compilation,
      'feature',
      'resource.html',
      includeList,
      {}
    )
    expect(compilation.updateAsset).toHaveBeenCalledWith(
      'feature.html',
      expect.any(sources.RawSource)
    )
  })

  it('should handle multiple HTML files', () => {
    const includeList = {
      feature1: 'resource1.html',
      feature2: 'resource2.html'
    }
    const plugin = new UpdateHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(patchHtml.patchHtml).toHaveBeenCalledTimes(2)
    expect(patchHtml.patchHtml).toHaveBeenCalledWith(
      compilation,
      'feature1',
      'resource1.html',
      includeList,
      {}
    )
    expect(patchHtml.patchHtml).toHaveBeenCalledWith(
      compilation,
      'feature2',
      'resource2.html',
      includeList,
      {}
    )
    expect(compilation.updateAsset).toHaveBeenCalledWith(
      'feature1.html',
      expect.any(sources.RawSource)
    )
    expect(compilation.updateAsset).toHaveBeenCalledWith(
      'feature2.html',
      expect.any(sources.RawSource)
    )
  })

  it('should skip excluded files', () => {
    const includeList = {feature: 'resource.html'}
    const excludeList = {feature: 'resource.html'}
    const plugin = new UpdateHtmlFile({
      manifestPath: 'manifest.json',
      includeList,
      excludeList
    })

    vi.mocked(utils.shouldExclude).mockReturnValue(true)
    vi.mocked(patchHtml.patchHtml).mockReturnValue('patched html content')

    plugin.apply(compiler)

    expect(patchHtml.patchHtml).toHaveBeenCalledWith(
      compilation,
      'feature',
      'resource.html',
      includeList,
      excludeList
    )
    expect(compilation.updateAsset).not.toHaveBeenCalled()
  })

  it('should skip processing if there are compilation errors', () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new UpdateHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    compilation.errors = ['Some error']

    plugin.apply(compiler)

    expect(patchHtml.patchHtml).not.toHaveBeenCalled()
    expect(compilation.updateAsset).not.toHaveBeenCalled()
  })

  it('should handle absolute paths in Windows environment', () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new UpdateHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock HTML content with absolute paths
    const htmlContent = `
      <html>
        <head>
          <link rel="stylesheet" href="/css/file.css">
        </head>
        <body>
          <script src="/js/file.js"></script>
        </body>
      </html>
    `
    vi.mocked(fs.readFileSync).mockReturnValue(htmlContent)

    plugin.apply(compiler)

    expect(patchHtml.patchHtml).toHaveBeenCalledWith(
      compilation,
      'feature',
      'resource.html',
      includeList,
      {}
    )
    expect(compilation.updateAsset).toHaveBeenCalledWith(
      'feature.html',
      expect.any(sources.RawSource)
    )
  })
})
