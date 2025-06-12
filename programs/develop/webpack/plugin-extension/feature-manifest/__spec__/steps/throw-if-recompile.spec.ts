let readFileSyncImpl: (filePath: string) => string = () => ''
let existsSyncImpl: (filePath: string) => boolean = () => true

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    readFileSync: vi.fn((filePath: string) =>
      readFileSyncImpl(String(filePath))
    ),
    existsSync: vi.fn((filePath: string) => existsSyncImpl(String(filePath)))
  }
})

import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {ThrowIfRecompileIsNeeded} from '../../steps/throw-if-recompile'
import {type Compiler, type Compilation} from '@rspack/core'
import {type PluginInterface} from '../../../../webpack-types'
import * as utils from '../../../../lib/utils'
import * as messages from '../../../../lib/messages'

describe('ThrowIfRecompileIsNeeded', () => {
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
    ],
    action: {
      default_popup: 'popup.html'
    }
  }

  let mockCompilation: Compilation
  let mockCompiler: Compiler
  let mockPluginInterface: PluginInterface

  beforeEach(() => {
    readFileSyncImpl = (filePath: string) => {
      if (filePath === mockManifestPath) {
        return JSON.stringify(mockManifest)
      }
      if (filePath === path.join(mockContext, 'package.json')) {
        return JSON.stringify({name: 'test-extension'})
      }
      throw new Error(`Unexpected file read: ${filePath}`)
    }
    existsSyncImpl = (filePath: string) =>
      filePath === path.join(mockContext, 'package.json')

    // Mock compilation
    mockCompilation = {
      errors: [],
      getAsset: vi.fn().mockReturnValue({
        source: {
          source: () => JSON.stringify(mockManifest)
        }
      }),
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
        context: mockContext
      },
      modifiedFiles: new Set([mockManifestPath]),
      hooks: {
        watchRun: {
          tapAsync: vi.fn((name, callback) => {
            callback(mockCompiler, () => {})
          })
        },
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
    vi.spyOn(utils, 'filterKeysForThisBrowser').mockReturnValue(mockManifest)
  })

  afterEach(() => {
    // no fs restore needed
    vi.restoreAllMocks()
  })

  it('should not throw error when manifest is unchanged', () => {
    const throwIfRecompile = new ThrowIfRecompileIsNeeded(mockPluginInterface)
    throwIfRecompile.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(0)
  })

  it('should throw error when HTML files are changed', () => {
    const updatedManifest = {
      ...mockManifest,
      action: {
        default_popup: 'new-popup.html'
      }
    }

    mockCompilation.getAsset = vi.fn().mockReturnValue({
      source: {
        source: () => JSON.stringify(updatedManifest)
      }
    })

    const throwIfRecompile = new ThrowIfRecompileIsNeeded(mockPluginInterface)
    throwIfRecompile.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(1)
    expect(mockCompilation.errors[0].message).toContain('new-popup.html')
  })

  it('should throw error when script files are changed', () => {
    const updatedManifest = {
      ...mockManifest,
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['new-content.js'],
          css: ['content1.css']
        }
      ]
    }

    mockCompilation.getAsset = vi.fn().mockReturnValue({
      source: {
        source: () => JSON.stringify(updatedManifest)
      }
    })

    const throwIfRecompile = new ThrowIfRecompileIsNeeded(mockPluginInterface)
    throwIfRecompile.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(1)
    expect(mockCompilation.errors[0].message).toContain(
      'Manifest Entry Point Modification'
    )
  })

  it('should not throw error when manifest is not modified', () => {
    mockCompiler.modifiedFiles = new Set(['other-file.js'])

    const throwIfRecompile = new ThrowIfRecompileIsNeeded(mockPluginInterface)
    throwIfRecompile.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(0)
  })

  it('should handle missing package.json gracefully', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)

    const throwIfRecompile = new ThrowIfRecompileIsNeeded(mockPluginInterface)
    throwIfRecompile.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(0)
  })

  it('should handle invalid manifest JSON gracefully', () => {
    mockCompilation.getAsset = vi.fn().mockReturnValue({
      source: {
        source: () => 'invalid-json'
      }
    })

    const throwIfRecompile = new ThrowIfRecompileIsNeeded(mockPluginInterface)
    throwIfRecompile.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(0)
  })
})
