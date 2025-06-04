import * as fs from 'fs'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import {EmitHtmlFile} from '../../steps/emit-html-file'
import * as utils from '../../../../lib/utils'
import {type FilepathList} from '../../../../webpack-types'

vi.mock('fs')
vi.mock('../../../../lib/utils')

describe('EmitHtmlFile', () => {
  let compilation: any
  let compiler: any
  let emitAssetSpy: any
  let warningsPushSpy: any
  let existsSyncSpy: any
  let readFileSyncSpy: any
  let processAssetsCallback: any

  beforeEach(() => {
    vi.clearAllMocks()

    emitAssetSpy = vi.fn()
    warningsPushSpy = vi.fn()
    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    readFileSyncSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockImplementation((path: fs.PathOrFileDescriptor) => {
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
        return '<html><body>Test</body></html>'
      })

    compilation = {
      hooks: {
        processAssets: {
          tap: (_opts: any, fn: any) => {
            processAssetsCallback = fn
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
      }
    }

    vi.mocked(utils.filterKeysForThisBrowser).mockReturnValue({
      name: 'Test Extension'
    })
  })

  it('should emit HTML files from include list', () => {
    const includeList: FilepathList = {feature: 'resource.html'}
    const plugin = new EmitHtmlFile({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)
    processAssetsCallback()

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
    processAssetsCallback()

    expect(warningsPushSpy).toHaveBeenCalled()
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
    processAssetsCallback()

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

    plugin.apply(compiler)
    processAssetsCallback()

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
})
