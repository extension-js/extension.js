import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'
import * as utils from '../../html-lib/utils'
import * as webpackUtils from '../../../../lib/utils'

vi.mock('fs')
vi.mock('path')
vi.mock('../../html-lib/utils')
vi.mock('../../../../lib/utils')
vi.mock('@rspack/core', () => {
  const WebpackError = class WebpackError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'WebpackError'
    }
  }

  return {
    default: {
      sources: {
        RawSource: vi.fn().mockImplementation((content) => ({content}))
      },
      Compilation: {
        PROCESS_ASSETS_STAGE_ADDITIONAL: 100
      },
      WebpackError
    },
    sources: {
      RawSource: vi.fn().mockImplementation((content) => ({content}))
    },
    Compilation: {
      PROCESS_ASSETS_STAGE_ADDITIONAL: 100
    },
    WebpackError
  }
})

describe('AddAssetsToCompilation', () => {
  let compilation: any
  let compiler: any
  let emitAssetSpy: any
  let getAssetSpy: any
  let warningsPushSpy: any
  let existsSyncSpy: any
  let readFileSyncSpy: any
  let processAssetsCallback: any

  beforeEach(() => {
    vi.clearAllMocks()

    emitAssetSpy = vi.fn()
    getAssetSpy = vi.fn()
    warningsPushSpy = vi.fn()
    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    readFileSyncSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(Buffer.from('file-content'))

    compilation = {
      hooks: {
        processAssets: {
          tap: (_opts: any, fn: any) => {
            processAssetsCallback = fn
          }
        }
      },
      getAsset: getAssetSpy,
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
      }
    }

    // Default path mocking for all tests
    vi.spyOn(path, 'join').mockImplementation((...args) => {
      return args.filter(Boolean).join('/')
    })
    vi.spyOn(path.posix, 'join').mockImplementation((...args) => {
      return args.filter(Boolean).join('/')
    })
    vi.spyOn(path, 'basename').mockImplementation((p) => {
      if (p === 'resource.html') return 'resource.html'
      if (p === 'nested/page.html') return 'page.html'
      return p.split('/').pop() || ''
    })
  })

  it('should emit assets for files in includeList', () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new AddAssetsToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    getAssetSpy.mockImplementation((name: string) => {
      if (name === 'resource.html') {
        return {
          source: {
            source: () => '<html><img src="foo.png"></html>'
          }
        }
      }
      return null
    })

    vi.mocked(utils.getAssetsFromHtml).mockReturnValue({
      css: [],
      js: [],
      static: ['foo.png']
    })
    vi.mocked(utils.isFromIncludeList).mockReturnValue(false)
    vi.mocked(webpackUtils.shouldExclude).mockReturnValue(false)

    plugin.apply(compiler)
    processAssetsCallback()

    expect(emitAssetSpy).toHaveBeenCalled()
    expect(readFileSyncSpy).toHaveBeenCalledWith('foo.png')
    expect(emitAssetSpy).toHaveBeenCalledWith(
      'assets/foo.png',
      expect.any(Object)
    )
    expect(warningsPushSpy).not.toHaveBeenCalled()
  })

  it('should preserve absolute paths in output', () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new AddAssetsToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    getAssetSpy.mockImplementation((name: string) => {
      if (name === 'resource.html') {
        return {
          source: {
            source: () => '<html><img src="/absolute/path/image.png"></html>'
          }
        }
      }
      return null
    })

    vi.mocked(utils.getAssetsFromHtml).mockReturnValue({
      css: [],
      js: [],
      static: ['/absolute/path/image.png']
    })
    vi.mocked(utils.isFromIncludeList).mockReturnValue(false)
    vi.mocked(webpackUtils.shouldExclude).mockReturnValue(false)

    plugin.apply(compiler)
    processAssetsCallback()

    expect(path.posix.join).toHaveBeenCalledWith(
      'public',
      'absolute/path/image.png'
    )
    expect(readFileSyncSpy).toHaveBeenCalledWith(
      'public/absolute/path/image.png'
    )
    expect(emitAssetSpy).toHaveBeenCalledWith(
      'absolute/path/image.png',
      expect.any(Object)
    )
  })

  it('should handle missing assets gracefully', () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new AddAssetsToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    getAssetSpy.mockImplementation((name: string) => {
      if (name === 'resource.html') {
        return {
          source: {
            source: () => '<html><img src="missing.png"></html>'
          }
        }
      }
      return null
    })

    vi.mocked(utils.getAssetsFromHtml).mockReturnValue({
      css: [],
      js: [],
      static: ['missing.png']
    })
    vi.mocked(utils.isFromIncludeList).mockReturnValue(false)
    vi.mocked(webpackUtils.shouldExclude).mockReturnValue(false)
    existsSyncSpy.mockReturnValue(false)

    plugin.apply(compiler)
    processAssetsCallback()

    expect(warningsPushSpy).toHaveBeenCalled()
    expect(emitAssetSpy).not.toHaveBeenCalled()
  })

  it('should handle assets in includeList', () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new AddAssetsToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    getAssetSpy.mockImplementation((name: string) => {
      if (name === 'resource.html') {
        return {
          source: {
            source: () => '<html><img src="included.png"></html>'
          }
        }
      }
      return null
    })

    vi.mocked(utils.getAssetsFromHtml).mockReturnValue({
      css: [],
      js: [],
      static: ['included.png']
    })
    vi.mocked(utils.isFromIncludeList).mockImplementation((asset) => {
      return asset === 'included.png'
    })
    vi.mocked(webpackUtils.shouldExclude).mockReturnValue(false)

    plugin.apply(compiler)
    processAssetsCallback()

    expect(warningsPushSpy).not.toHaveBeenCalled()
    expect(emitAssetSpy).not.toHaveBeenCalled()
  })
})
