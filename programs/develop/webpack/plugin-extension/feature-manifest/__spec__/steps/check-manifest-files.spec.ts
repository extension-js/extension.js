let existsSyncImpl: (filePath: string) => boolean = () => true

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    existsSync: vi.fn((filePath: string) => existsSyncImpl(String(filePath))),
    readFileSync: vi.fn((filePath: string) => {
      throw new Error('readFileSync not mocked')
    })
  }
})

import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {CheckManifestFiles} from '../../steps/check-manifest-files'
import {type Compiler, type Compilation} from '@rspack/core'
import {
  type PluginInterface,
  type FilepathList
} from '../../../../webpack-types'

describe('CheckManifestFiles', () => {
  const mockContext = '/mock/context'
  const mockManifestPath = path.join(mockContext, 'manifest.json')
  const mockManifest = {
    name: 'Test Extension',
    version: '1.0.0',
    action: {
      default_popup: 'popup.html',
      default_icon: 'icon.png'
    },
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png'
    }
  }

  let mockCompilation: Compilation
  let mockCompiler: Compiler
  let mockPluginInterface: PluginInterface

  beforeEach(() => {
    existsSyncImpl = (filePath: string) =>
      !String(filePath).includes('non-existent')
    vi.spyOn(fs, 'readFileSync').mockImplementation((filePath) => {
      if (filePath === mockManifestPath) {
        return JSON.stringify(mockManifest)
      }
      throw new Error(`Unexpected file read: ${filePath}`)
    })

    // Mock compilation
    mockCompilation = {
      errors: [],
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
      hooks: {
        compilation: {
          tap: vi.fn((name, callback) => {
            callback(mockCompilation)
          })
        }
      }
    } as unknown as Compiler

    // Mock plugin interface
    mockPluginInterface = {
      manifestPath: mockManifestPath,
      browser: 'chrome',
      includeList: {
        'action/default_popup': 'popup.html',
        'action/default_icon': 'icon.png',
        'icons/16': 'icons/icon16.png',
        'icons/48': 'icons/icon48.png',
        'icons/128': 'icons/icon128.png'
      }
    }
  })

  afterEach(() => {
    // no fs restore needed
    vi.restoreAllMocks()
  })

  it('should not add errors for existing files', () => {
    const checkManifestFiles = new CheckManifestFiles(mockPluginInterface)
    checkManifestFiles.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(0)
  })

  it('should add errors for non-existent files', () => {
    const checkManifestFiles = new CheckManifestFiles({
      ...mockPluginInterface,
      includeList: {
        'action/default_popup': 'non-existent.html',
        'action/default_icon': 'non-existent.png'
      }
    })
    checkManifestFiles.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(2)
  })

  it('should handle absolute paths without errors', () => {
    const checkManifestFiles = new CheckManifestFiles({
      ...mockPluginInterface,
      includeList: {
        'action/default_popup': '/absolute/path/popup.html'
      }
    })
    checkManifestFiles.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(0)
  })

  it('should handle theme icons correctly', () => {
    const themeIcons: FilepathList = {
      'browser_action/theme_icons': ['icons/light16.png', 'icons/dark16.png']
    }

    const checkManifestFiles = new CheckManifestFiles({
      ...mockPluginInterface,
      includeList: themeIcons
    })
    checkManifestFiles.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(0)
  })

  it('should handle non-existent theme icons', () => {
    const themeIcons: FilepathList = {
      'browser_action/theme_icons': [
        'non-existent/light16.png',
        'non-existent/dark16.png'
      ]
    }

    const checkManifestFiles = new CheckManifestFiles({
      ...mockPluginInterface,
      includeList: themeIcons
    })
    checkManifestFiles.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(2)
  })

  it('should handle different file extensions correctly', () => {
    const checkManifestFiles = new CheckManifestFiles({
      ...mockPluginInterface,
      includeList: {
        'action/default_popup': 'non-existent.html',
        'action/default_icon': 'non-existent.png',
        'background/service_worker': 'non-existent.js',
        options_page: 'non-existent.json'
      }
    })
    checkManifestFiles.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(4)
  })

  it('should handle empty includeList', () => {
    const checkManifestFiles = new CheckManifestFiles({
      ...mockPluginInterface,
      includeList: {}
    })
    checkManifestFiles.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(0)
  })

  it('should handle undefined includeList', () => {
    const checkManifestFiles = new CheckManifestFiles({
      ...mockPluginInterface,
      includeList: undefined
    })
    checkManifestFiles.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(0)
  })
})
