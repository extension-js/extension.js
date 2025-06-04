import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach} from 'vitest'
import ensureHMRForScripts from '../../steps/ensure-hmr-for-scripts'
import * as utils from '../../../../lib/utils'
import {getAssetsFromHtml} from '../../html-lib/utils'

vi.mock('fs')
vi.mock('path')
vi.mock('../../../../lib/utils')
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
    vi.mocked(getAssetsFromHtml).mockReturnValue({
      js: ['scripts/other.js'],
      css: [],
      static: []
    })

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).not.toContain('import.meta.webpackHot.accept()')
    expect(result).toBe('console.log("test")')
  })

  it('should not inject HMR code when using JS framework', () => {
    vi.mocked(utils.isUsingJSFramework).mockReturnValue(true)

    const result = ensureHMRForScripts.call(
      loaderContext,
      'console.log("test")'
    )

    expect(result).not.toContain('import.meta.webpackHot.accept()')
    expect(result).toBe('console.log("test")')
  })
})
