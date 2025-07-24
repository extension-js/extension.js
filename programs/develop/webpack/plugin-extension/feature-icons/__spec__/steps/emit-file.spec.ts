import {describe, it, expect, vi, beforeEach} from 'vitest'
import {EmitFile} from '../../steps/emit-file'
import * as fs from 'fs'
import * as path from 'path'
import * as utils from '../../../../lib/utils'
import {type FilepathList} from '../../../../webpack-types'
import {sources} from '@rspack/core'

vi.mock('fs')
vi.mock('path')
vi.mock('../../../../lib/utils')

describe('EmitFile', () => {
  let compiler: any
  let compilation: any
  let existsSyncSpy: any
  let readFileSyncSpy: any
  let basenameSpy: any
  let shouldExcludeSpy: any
  let emittedAssets: Map<string, any>

  beforeEach(() => {
    vi.clearAllMocks()

    existsSyncSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    readFileSyncSpy = vi
      .spyOn(fs, 'readFileSync')
      .mockReturnValue(Buffer.from('icon data'))
    basenameSpy = vi.spyOn(path, 'basename').mockImplementation((filePath) => {
      const parts = filePath.split('/')
      return parts[parts.length - 1]
    })
    shouldExcludeSpy = vi.spyOn(utils, 'shouldExclude').mockReturnValue(false)

    // Create a Map for emitted assets
    emittedAssets = new Map()

    // Mock compilation object
    compilation = {
      errors: [],
      emitAsset: vi.fn((filename, source) => {
        emittedAssets.set(filename, source)
      }),
      hooks: {
        processAssets: {
          tap: vi.fn((options, callback) => {
            callback()
          })
        }
      }
    }

    // Mock compiler object
    compiler = {
      hooks: {
        thisCompilation: {
          tap: vi.fn((name, callback) => {
            callback(compilation)
          })
        }
      }
    }
  })

  it('should emit icon files', () => {
    const includeList: FilepathList = {
      browser_action: 'icon.png',
      page_action: 'page_icon.png'
    }
    const plugin = new EmitFile({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(emittedAssets.size).toBe(2)
    expect(emittedAssets.has('browser_action/icon.png')).toBe(true)
    expect(emittedAssets.has('page_action/page_icon.png')).toBe(true)
  })

  it('should not emit files that do not exist', () => {
    const includeList: FilepathList = {
      browser_action: 'icon.png'
    }
    const plugin = new EmitFile({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock file does not exist
    existsSyncSpy.mockReturnValue(false)

    plugin.apply(compiler)

    expect(emittedAssets.size).toBe(0)
  })

  it('should not emit files if compilation has errors', () => {
    const includeList: FilepathList = {
      browser_action: 'icon.png'
    }
    const plugin = new EmitFile({
      manifestPath: 'manifest.json',
      includeList
    })

    // Set compilation errors
    compilation.errors = ['Some error']

    plugin.apply(compiler)

    expect(emittedAssets.size).toBe(0)
  })

  it('should handle array of resources', () => {
    const includeList: FilepathList = {
      browser_action: ['icon16.png', 'icon32.png', 'icon48.png']
    }
    const plugin = new EmitFile({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(emittedAssets.size).toBe(3)
    expect(emittedAssets.has('browser_action/icon16.png')).toBe(true)
    expect(emittedAssets.has('browser_action/icon32.png')).toBe(true)
    expect(emittedAssets.has('browser_action/icon48.png')).toBe(true)
  })

  it('should handle theme icons', () => {
    const includeList: FilepathList = {
      browser_action_theme_icons: 'icon.png'
    }
    const plugin = new EmitFile({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(emittedAssets.size).toBe(1)
    expect(emittedAssets.has('browser_action/icon.png')).toBe(true)
  })

  it('should not emit excluded files', () => {
    const includeList: FilepathList = {
      browser_action: 'icon.png'
    }
    const plugin = new EmitFile({
      manifestPath: 'manifest.json',
      includeList
    })

    // Mock shouldExclude to return true
    shouldExcludeSpy.mockReturnValue(true)

    plugin.apply(compiler)

    expect(emittedAssets.size).toBe(0)
  })

  it('should handle undefined resources', () => {
    const includeList: FilepathList = {
      browser_action: undefined
    }
    const plugin = new EmitFile({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(emittedAssets.size).toBe(0)
  })

  it('should emit files with correct source', () => {
    const includeList: FilepathList = {
      browser_action: 'icon.png'
    }
    const plugin = new EmitFile({
      manifestPath: 'manifest.json',
      includeList
    })

    plugin.apply(compiler)

    expect(emittedAssets.size).toBe(1)
    const source = emittedAssets.get('browser_action/icon.png')
    expect(source).toBeInstanceOf(sources.RawSource)
    expect(source.source()).toEqual(Buffer.from('icon data'))
  })
})
