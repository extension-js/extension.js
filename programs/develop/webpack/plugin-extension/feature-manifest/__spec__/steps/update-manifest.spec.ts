let readFileSyncImpl: (filePath: string) => string = () => ''

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    readFileSync: vi.fn((filePath: string) =>
      readFileSyncImpl(String(filePath))
    )
  }
})

import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {UpdateManifest} from '../../steps/update-manifest'
import {
  type Compiler,
  type Compilation,
  sources,
  WebpackError
} from '@rspack/core'
import {type PluginInterface} from '../../../../webpack-types'
import * as utils from '../../../../lib/utils'
import * as manifestOverrides from '../../manifest-overrides'

describe('UpdateManifest', () => {
  const mockContext = '/mock/context'
  const mockManifestPath = path.join(mockContext, 'manifest.json')
  const mockManifest = {
    name: 'Test Extension',
    version: '1.0.0',
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content1.js'],
        css: ['content1.css']
      }
    ]
  }

  let mockCompilation: Compilation
  let mockCompiler: Compiler
  let mockPluginInterface: PluginInterface

  beforeEach(() => {
    readFileSyncImpl = (filePath: string) => {
      if (filePath === mockManifestPath) {
        return JSON.stringify(mockManifest)
      }
      throw new Error(`Unexpected file read: ${filePath}`)
    }

    // Mock compilation
    mockCompilation = {
      errors: [],
      updateAsset: vi.fn(),
      hooks: {
        processAssets: {
          tap: vi.fn((options, callback) => {
            callback()
          })
        }
      }
    } as unknown as Compilation

    // Mock compiler
    mockCompiler = {
      options: {
        mode: 'development'
      },
      hooks: {
        thisCompilation: {
          tap: vi.fn((name, callback) => {
            callback(mockCompilation)
          })
        }
      }
    } as unknown as Compiler

    // Mock plugin interface
    mockPluginInterface = {
      manifestPath: mockManifestPath,
      browser: 'chrome'
    }

    // Mock utils
    vi.spyOn(utils, 'getManifestContent').mockReturnValue(mockManifest)
    vi.spyOn(utils, 'getFilename').mockReturnValue('content_scripts-0.js')

    // Mock manifest overrides
    vi.spyOn(manifestOverrides, 'getManifestOverrides').mockReturnValue(
      JSON.stringify({
        content_scripts: [
          {
            matches: ['<all_urls>'],
            js: ['content_scripts/content-0.js'],
            css: ['content_scripts/content-0.css']
          }
        ]
      })
    )
  })

  afterEach(() => {
    // no fs restore needed
    vi.restoreAllMocks()
  })

  it('should update manifest with overrides', () => {
    const updateManifest = new UpdateManifest(mockPluginInterface)
    updateManifest.apply(mockCompiler)

    expect(mockCompilation.updateAsset).toHaveBeenCalledWith(
      'manifest.json',
      expect.any(sources.RawSource)
    )

    const emittedContent = JSON.parse(
      (mockCompilation.updateAsset as any).mock.calls[0][1].source()
    )
    expect(emittedContent.name).toBe('Test Extension')
    expect(emittedContent.version).toBe('1.0.0')
    expect(emittedContent.content_scripts[0].js).toContain(
      'content_scripts/content-0.js'
    )
  })

  it('should add dev.js file for content scripts with only CSS in development mode', () => {
    const manifestWithOnlyCss = {
      ...mockManifest,
      content_scripts: [
        {
          matches: ['<all_urls>'],
          css: ['content1.css']
        }
      ]
    }

    vi.spyOn(utils, 'getManifestContent').mockReturnValue(manifestWithOnlyCss)

    const updateManifest = new UpdateManifest(mockPluginInterface)
    updateManifest.apply(mockCompiler)

    const emittedContent = JSON.parse(
      (mockCompilation.updateAsset as any).mock.calls[0][1].source()
    )
    expect(emittedContent.content_scripts[0].js).toContain(
      'content_scripts/content-0.js'
    )
  })

  it('should not add dev.js file for content scripts with JS in development mode', () => {
    const updateManifest = new UpdateManifest(mockPluginInterface)
    updateManifest.apply(mockCompiler)

    const emittedContent = JSON.parse(
      (mockCompilation.updateAsset as any).mock.calls[0][1].source()
    )
    expect(emittedContent.content_scripts[0].js).not.toContain(
      'content_scripts-0.js'
    )
  })

  it('should handle production mode correctly', () => {
    mockCompiler.options.mode = 'production'
    const updateManifest = new UpdateManifest(mockPluginInterface)
    updateManifest.apply(mockCompiler)

    expect(mockCompilation.updateAsset).toHaveBeenCalledTimes(2)
  })

  it('should not update manifest if compilation has errors', () => {
    mockCompilation.errors = [new WebpackError('Some error')]
    const updateManifest = new UpdateManifest(mockPluginInterface)
    updateManifest.apply(mockCompiler)

    expect(mockCompilation.updateAsset).not.toHaveBeenCalled()
  })

  it('should handle invalid manifest JSON', () => {
    vi.spyOn(utils, 'getManifestContent').mockImplementation(() => {
      throw new Error('Invalid JSON')
    })

    const updateManifest = new UpdateManifest(mockPluginInterface)
    updateManifest.apply(mockCompiler)

    expect(mockCompilation.updateAsset).not.toHaveBeenCalled()
  })

  it('should handle missing manifest file', () => {
    vi.spyOn(utils, 'getManifestContent').mockImplementation(() => {
      throw new Error('File not found')
    })

    const updateManifest = new UpdateManifest(mockPluginInterface)
    updateManifest.apply(mockCompiler)

    expect(mockCompilation.updateAsset).not.toHaveBeenCalled()
  })

  it('should preserve uncatched user entries in manifest', () => {
    const manifestWithCustomFields = {
      ...mockManifest,
      custom_field: 'custom_value',
      permissions: ['storage', 'tabs']
    }

    vi.spyOn(utils, 'getManifestContent').mockReturnValue(
      manifestWithCustomFields as any
    )

    const updateManifest = new UpdateManifest(mockPluginInterface)
    updateManifest.apply(mockCompiler)

    const emittedContent = JSON.parse(
      (mockCompilation.updateAsset as any).mock.calls[0][1].source()
    )
    expect(emittedContent.custom_field).toBe('custom_value')
    expect(emittedContent.permissions).toEqual(['storage', 'tabs'])
  })
})
