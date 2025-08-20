import * as fs from 'fs'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {EmitHtmlFile} from '../../steps/emit-html-file'
import * as utils from '../../../../lib/utils'
import {type FilepathList} from '../../../../webpack-types'

vi.mock('fs')
vi.mock('../../../../lib/utils')

describe('EmitHtmlFile', () => {
  let emitAssetSpy: ReturnType<typeof vi.fn>
  let warningsPushSpy: ReturnType<typeof vi.fn>
  let existsSyncSpy: ReturnType<typeof vi.spyOn>
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>
  let compilation: any
  let compiler: any
  let processAssetsCallback: (() => void) | undefined

  beforeEach(() => {
    vi.clearAllMocks()

    emitAssetSpy = vi.fn()
    warningsPushSpy = vi.fn()
    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true) as any
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync') as any

    readFileSyncSpy.mockImplementation(((path: fs.PathOrFileDescriptor) => {
      if (path === 'manifest.json') {
        return JSON.stringify({
          name: 'Test Extension',
          browser_specific_settings: {
            gecko: {id: 'test@example.com'}
          }
        })
      }
      return '<html><body>Test</body></html>'
    }) as any)

    compilation = {
      hooks: {
        processAssets: {
          tap: (_opts: any, fn: any) => {
            processAssetsCallback = () => fn({})
          }
        }
      },
      emitAsset: emitAssetSpy,
      warnings: {push: warningsPushSpy},
      errors: []
    }

    compiler = {
      hooks: {
        thisCompilation: {
          tap: (_name: string, fn: any) => {
            fn(compilation)
          }
        }
      },
      options: {}
    }

    vi.mocked(utils.filterKeysForThisBrowser).mockReturnValue({
      name: 'Test Extension'
    })
    // Default behavior: do not exclude unless a test explicitly overrides
    // Prevents leakage from prior tests that set a different return value
    if (typeof utils.shouldExclude === 'function') {
      vi.mocked(utils.shouldExclude as any).mockReturnValue(false as any)
    }
  })

  it('should emit HTML files from include list', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    readFileSyncSpy.mockImplementation(((path: fs.PathOrFileDescriptor) => {
      if (path === 'manifest.json') {
        return JSON.stringify({
          name: 'Test Extension',
          browser_specific_settings: {
            gecko: {id: 'test@example.com'}
          }
        })
      }
      return '<html><body>Test</body></html>'
    }) as any)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).toHaveBeenCalledWith(
      'feature.html',
      expect.any(Object)
    )
    expect(warningsPushSpy).not.toHaveBeenCalled()
  })

  it('should handle missing files gracefully', () => {
    const includeList: FilepathList = {feature: 'missing.html'}
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    existsSyncSpy.mockReturnValue(false)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    // For non-pages features we no longer warn here (manifest handles entrypoints)
    expect(warningsPushSpy).not.toHaveBeenCalled()
    expect(emitAssetSpy).not.toHaveBeenCalled()
  })

  it('should exclude files based on exclude list', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const excludeList: FilepathList = {resource: 'resource.html'}
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList,
      excludeList
    })

    vi.mocked(utils.shouldExclude).mockReturnValue(true)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).not.toHaveBeenCalled()
    expect(warningsPushSpy).not.toHaveBeenCalled()
  })

  it('should handle multiple HTML files', () => {
    const includeList: FilepathList = {
      feature1: 'resource1.html',
      feature2: 'resource2.html'
    }
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    existsSyncSpy.mockImplementation(((path: fs.PathOrFileDescriptor) => {
      return path === 'resource1.html' || path === 'resource2.html'
    }) as any)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(existsSyncSpy).toHaveBeenCalledTimes(2)
    expect(existsSyncSpy).toHaveBeenCalledWith('resource1.html')
    expect(existsSyncSpy).toHaveBeenCalledWith('resource2.html')
    expect(emitAssetSpy).toHaveBeenCalledTimes(2)
    expect(emitAssetSpy).toHaveBeenCalledWith(
      'feature1.html',
      expect.any(Object)
    )
    expect(emitAssetSpy).toHaveBeenCalledWith(
      'feature2.html',
      expect.any(Object)
    )
  })

  it('should handle invalid manifest JSON', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    readFileSyncSpy.mockReturnValue('invalid json')

    expect(() => {
      plugin.apply(compiler)
    }).toThrow()
  })

  it('should handle missing manifest file', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    readFileSyncSpy.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    expect(() => {
      plugin.apply(compiler)
    }).toThrow()
  })

  it('should handle undefined resources in includeList', () => {
    const includeList: FilepathList = {
      feature1: 'resource1.html',
      feature2: undefined
    }
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).toHaveBeenCalledTimes(1)
    expect(emitAssetSpy).toHaveBeenCalledWith(
      'feature1.html',
      expect.any(Object)
    )
  })

  it('should handle empty HTML content', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    readFileSyncSpy.mockImplementation(((path: fs.PathOrFileDescriptor) => {
      if (path === 'manifest.json') {
        return JSON.stringify({
          name: 'Test Extension',
          browser_specific_settings: {
            gecko: {
              id: 'test@example.com'
            }
          }
        })
      }
      return ''
    }) as any)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).toHaveBeenCalledWith(
      'feature.html',
      expect.any(Object)
    )
  })

  it('should handle HTML content with special characters', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    const htmlContent = `
      <html>
        <head>
          <title>Special &amp; Characters &lt; &gt; &quot; &apos;</title>
        </head>
        <body>
          <script src="file.js"></script>
        </body>
      </html>
    `
    readFileSyncSpy.mockImplementation(((path: fs.PathOrFileDescriptor) => {
      if (path === 'manifest.json') {
        return JSON.stringify({
          name: 'Test Extension',
          browser_specific_settings: {
            gecko: {
              id: 'test@example.com'
            }
          }
        })
      }
      return htmlContent
    }) as any)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).toHaveBeenCalledWith(
      'feature.html',
      expect.any(Object)
    )
  })

  it('should handle HTML content with different encodings', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    const htmlContent = Buffer.from(
      `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>UTF-8 Content: 你好世界</title>
        </head>
        <body>
          <script src="file.js"></script>
        </body>
      </html>
    `,
      'utf-8'
    ).toString('utf-8')
    readFileSyncSpy.mockImplementation(((path: fs.PathOrFileDescriptor) => {
      if (path === 'manifest.json') {
        return JSON.stringify({
          name: 'Test Extension',
          browser_specific_settings: {
            gecko: {
              id: 'test@example.com'
            }
          }
        })
      }
      return htmlContent
    }) as any)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).toHaveBeenCalledWith(
      'feature.html',
      expect.any(Object)
    )
  })

  it('should handle empty includeList', () => {
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList: {}
    })

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).not.toHaveBeenCalled()
    expect(warningsPushSpy).not.toHaveBeenCalled()
  })

  it('should skip non-string resource paths when emitting HTML files', () => {
    const includeList: FilepathList = {
      feature1: 'resource1.html',
      feature2: 123 as any
    }
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    existsSyncSpy.mockImplementation(((path: fs.PathOrFileDescriptor) => {
      return path === 'resource1.html'
    }) as any)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(existsSyncSpy).toHaveBeenCalledTimes(1)
    expect(existsSyncSpy).toHaveBeenCalledWith('resource1.html')
    expect(emitAssetSpy).toHaveBeenCalledTimes(1)
    expect(emitAssetSpy).toHaveBeenCalledWith(
      'feature1.html',
      expect.any(Object)
    )
  })

  it('should warn and skip missing files for pages/* only', () => {
    const includeList: FilepathList = {
      'pages/feature1': 'resource1.html',
      'pages/feature2': 'missing.html'
    }
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    existsSyncSpy.mockImplementation(((path: fs.PathOrFileDescriptor) => {
      return path === 'resource1.html'
    }) as any)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(existsSyncSpy).toHaveBeenCalledTimes(2)
    expect(existsSyncSpy).toHaveBeenCalledWith('resource1.html')
    expect(existsSyncSpy).toHaveBeenCalledWith('missing.html')
    expect(emitAssetSpy).toHaveBeenCalledTimes(1)
    expect(emitAssetSpy).toHaveBeenCalledWith(
      'pages/feature1.html',
      expect.any(Object)
    )
    expect(warningsPushSpy).toHaveBeenCalledTimes(1)
  })

  it('should handle multiple exclude patterns', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const excludeList: FilepathList = {
      feature: ['resource.html', 'other.html']
    }
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList,
      excludeList
    })

    vi.mocked(utils.shouldExclude).mockReturnValue(true)

    plugin.apply(compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).not.toHaveBeenCalled()
    expect(warningsPushSpy).not.toHaveBeenCalled()
  })
})
