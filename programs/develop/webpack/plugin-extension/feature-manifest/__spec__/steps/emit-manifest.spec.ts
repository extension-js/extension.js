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
import {EmitManifest} from '../../steps/emit-manifest'
import {type Compiler, type Compilation, sources} from '@rspack/core'
import {type PluginInterface} from '../../../../webpack-types'

describe('EmitManifest', () => {
  const mockContext = '/mock/context'
  const mockManifestPath = path.join(mockContext, 'manifest.json')
  const mockManifest = {
    name: 'Test Extension',
    version: '1.0.0',
    $schema: 'https://json.schemastore.org/chrome-manifest.json',
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
      throw new Error(`Unexpected file read: ${filePath}`)
    }

    // Mock compilation
    mockCompilation = {
      errors: [],
      emitAsset: vi.fn(),
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
  })

  afterEach(() => {
    // no fs restore needed
  })

  it('should emit manifest without $schema field', () => {
    const emitManifest = new EmitManifest(mockPluginInterface)
    emitManifest.apply(mockCompiler)

    expect(mockCompilation.emitAsset).toHaveBeenCalledWith(
      'manifest.json',
      expect.any(sources.RawSource)
    )

    const emittedContent = JSON.parse(
      (mockCompilation.emitAsset as any).mock.calls[0][1].source()
    )
    expect(emittedContent.$schema).toBeUndefined()
    expect(emittedContent.name).toBe('Test Extension')
    expect(emittedContent.version).toBe('1.0.0')
  })

  it('should handle manifest without $schema field', () => {
    const manifestWithoutSchema = {
      name: 'Test Extension',
      version: '1.0.0',
      action: {
        default_popup: 'popup.html'
      }
    }

    readFileSyncImpl = (filePath: string) => {
      if (filePath === mockManifestPath) {
        return JSON.stringify(manifestWithoutSchema)
      }
      throw new Error(`Unexpected file read: ${filePath}`)
    }

    const emitManifest = new EmitManifest(mockPluginInterface)
    emitManifest.apply(mockCompiler)

    const emittedContent = JSON.parse(
      (mockCompilation.emitAsset as any).mock.calls[0][1].source()
    )
    expect(emittedContent.$schema).toBeUndefined()
    expect(emittedContent.name).toBe('Test Extension')
  })

  it('should add error for invalid manifest JSON', () => {
    readFileSyncImpl = (filePath: string) => {
      if (filePath === mockManifestPath) {
        return 'invalid json'
      }
      throw new Error(`Unexpected file read: ${filePath}`)
    }

    const emitManifest = new EmitManifest(mockPluginInterface)
    emitManifest.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(1)
    expect(mockCompilation.emitAsset).not.toHaveBeenCalled()
  })

  it('should add error for non-existent manifest file', () => {
    readFileSyncImpl = () => {
      throw new Error('File not found')
    }

    const emitManifest = new EmitManifest(mockPluginInterface)
    emitManifest.apply(mockCompiler)

    expect(mockCompilation.errors).toHaveLength(1)
    expect(mockCompilation.emitAsset).not.toHaveBeenCalled()
  })
})
