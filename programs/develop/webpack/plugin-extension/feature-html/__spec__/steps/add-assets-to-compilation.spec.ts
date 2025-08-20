const FS = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn()
}))
vi.mock('fs', () => ({
  ...FS
}))
import * as fs from 'fs'
import * as path from 'path'
import type {Compilation, Compiler} from '@rspack/core'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {AddAssetsToCompilation} from '../../steps/add-assets-to-compilation'
import * as utils from '../../html-lib/utils'
import * as webpackUtils from '../../../../lib/utils'

vi.mock('../../html-lib/utils')
vi.mock('../../../../lib/utils')
vi.mock('../../html-lib/patch-html', () => ({
  patchHtmlNested: vi
    .fn()
    .mockImplementation((_c, _p) => '<html>patched</html>')
}))
vi.mock('@rspack/core', () => {
  class WebpackError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'WebpackError'
    }
  }
  class RawSource {
    public content: any
    constructor(content: any) {
      this.content = content
    }
    source() {
      return this.content
    }
  }
  return {
    default: {
      sources: {
        RawSource
      },
      Compilation: {
        PROCESS_ASSETS_STAGE_ADDITIONAL: 100
      },
      WebpackError
    },
    sources: {
      RawSource
    },
    Compilation: {
      PROCESS_ASSETS_STAGE_ADDITIONAL: 100
    },
    WebpackError
  }
})

describe('AddAssetsToCompilation', () => {
  let compilation: Partial<Compilation>
  let compiler: Partial<Compiler>
  let emitAssetSpy: ReturnType<typeof vi.fn>
  let getAssetSpy: ReturnType<typeof vi.fn>
  let warningsPushSpy: ReturnType<typeof vi.fn>
  let existsSyncSpy: ReturnType<typeof vi.spyOn>
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>
  let processAssetsCallback: () => void

  beforeEach(() => {
    vi.clearAllMocks()

    emitAssetSpy = vi.fn()
    getAssetSpy = vi.fn()
    warningsPushSpy = vi.fn()
    existsSyncSpy = vi.spyOn(fs, 'existsSync') as any
    existsSyncSpy.mockImplementation(() => true)
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync') as any
    readFileSyncSpy.mockImplementation(() => Buffer.from('file-content'))

    compilation = {
      hooks: {
        processAssets: {
          tap: (_opts: unknown, fn: (assets: Record<string, any>) => void) => {
            processAssetsCallback = () => fn({})
          }
        } as any
      } as any,
      getAsset: getAssetSpy,
      emitAsset: emitAssetSpy,
      warnings: {push: warningsPushSpy} as any,
      errors: []
    }

    compiler = {
      hooks: {
        thisCompilation: {
          tap: (
            _name: string,
            fn: (compilation: Compilation, params: any) => void
          ) => {
            fn(compilation as Compilation, {})
          }
        } as any
      } as any
    }

    // leave path methods intact to avoid redefining builtins
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
            source: () => '<html><img src="extensionjs.png"></html>'
          }
        }
      }
      return null
    })

    vi.mocked(utils.getAssetsFromHtml).mockReturnValue({
      css: [],
      js: [],
      static: ['extensionjs.png']
    })
    vi.mocked(utils.isFromIncludeList).mockReturnValue(false)
    vi.mocked(webpackUtils.shouldExclude).mockReturnValue(false)

    plugin.apply(compiler as Compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).toHaveBeenCalledTimes(1)
    expect(readFileSyncSpy).toHaveBeenCalledWith('extensionjs.png')
    expect(emitAssetSpy).toHaveBeenCalledWith(
      'assets/extensionjs.png',
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

    plugin.apply(compiler as Compiler)
    processAssetsCallback()

    // Ensure the read and emit paths match the expected absolute resolution
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

    plugin.apply(compiler as Compiler)
    if (processAssetsCallback) processAssetsCallback()

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

    plugin.apply(compiler as Compiler)
    processAssetsCallback()

    expect(warningsPushSpy).not.toHaveBeenCalled()
    expect(emitAssetSpy).not.toHaveBeenCalled()
  })

  it('should patch and emit nested HTML files', () => {
    const includeList = {feature: 'resource.html'}
    const plugin = new AddAssetsToCompilation({
      manifestPath: 'manifest.json',
      includeList
    })

    getAssetSpy.mockImplementation((name: string) => {
      if (name === 'resource.html') {
        return {
          source: {
            source: () => '<html><a href="nested/page.html">Page</a></html>'
          }
        }
      }
      return null
    })

    // First call for top-level returns nested HTML; second call for nested returns no further assets
    vi.mocked(utils.getAssetsFromHtml)
      .mockReturnValueOnce({css: [], js: [], static: ['nested/page.html']})
      .mockReturnValueOnce({css: [], js: [], static: []})

    // fs.existsSync for nested HTML
    existsSyncSpy.mockReturnValue(true)
    // readFileSync returns nested HTML content
    readFileSyncSpy.mockReturnValue('<html>nested</html>' as any)

    plugin.apply(compiler as Compiler)
    if (processAssetsCallback) processAssetsCallback()

    expect(emitAssetSpy).toHaveBeenCalledWith(
      'assets/nested/page.html',
      expect.objectContaining({content: expect.any(String)})
    )
  })
})
