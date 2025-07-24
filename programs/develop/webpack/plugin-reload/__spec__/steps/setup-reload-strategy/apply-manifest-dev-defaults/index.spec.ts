import {describe, it, expect, vi, beforeEach} from 'vitest'
import {ApplyManifestDevDefaults} from '../../../../steps/setup-reload-strategy/apply-manifest-dev-defaults'
import {type Manifest} from '../../../../../webpack-types'
import {type PluginInterface} from '../../../../reload-types'
import * as utils from '../../../../../lib/utils'

// Mock the utils module
vi.mock('../../../../../lib/utils', () => ({
  getManifestContent: vi.fn()
}))

describe('ApplyManifestDevDefaults', () => {
  let plugin: ApplyManifestDevDefaults
  let mockCompiler: any
  let mockCompilation: any

  beforeEach(() => {
    const pluginOptions: PluginInterface = {
      manifestPath: 'manifest.json',
      browser: 'chrome'
    }

    plugin = new ApplyManifestDevDefaults(pluginOptions)

    mockCompilation = {
      getAsset: vi.fn(),
      updateAsset: vi.fn(),
      hooks: {
        processAssets: {
          tap: vi.fn()
        }
      },
      errors: []
    }

    mockCompiler = {
      hooks: {
        thisCompilation: {
          tap: vi.fn((name, callback) => {
            callback(mockCompilation)
          })
        }
      },
      rspack: {
        WebpackError: class WebpackError extends Error {
          constructor(message: string) {
            super(message)
            this.name = 'WebpackError'
          }
        }
      }
    }
  })

  it('should apply manifest patches correctly', () => {
    const mockManifest: Manifest = {
      manifest_version: 3,
      name: 'Test Extension',
      version: '1.0.0'
    }

    vi.mocked(utils.getManifestContent).mockReturnValue(mockManifest)
    mockCompilation.getAsset.mockReturnValue(true)

    plugin.apply(mockCompiler)

    // Verify that the hooks were tapped
    expect(mockCompiler.hooks.thisCompilation.tap).toHaveBeenCalledWith(
      'run-chromium:apply-manifest-dev-defaults',
      expect.any(Function)
    )

    // Get the processAssets callback
    const processAssetsCallback =
      mockCompilation.hooks.processAssets.tap.mock.calls[0][1]

    // Call the processAssets callback
    processAssetsCallback({})

    // Verify that getManifestContent was called
    expect(utils.getManifestContent).toHaveBeenCalledWith(
      mockCompilation,
      'manifest.json'
    )

    // Verify that updateAsset was called with the patched manifest
    expect(mockCompilation.updateAsset).toHaveBeenCalled()
    const updateAssetCall = mockCompilation.updateAsset.mock.calls[0]
    expect(updateAssetCall[0]).toBe('manifest.json')
    expect(updateAssetCall[1]).toBeDefined()
  })

  it('should handle missing manifest.json', () => {
    mockCompilation.getAsset.mockReturnValue(false)

    plugin.apply(mockCompiler)

    // Get the processAssets callback
    const processAssetsCallback =
      mockCompilation.hooks.processAssets.tap.mock.calls[0][1]

    // Call the processAssets callback
    processAssetsCallback({})

    // Verify that an error was added to compilation.errors
    expect(mockCompilation.errors).toHaveLength(1)
    expect(mockCompilation.errors[0].message).toContain(
      'No manifest.json found in your extension bundle'
    )
  })

  it('should handle missing manifestPath', () => {
    // Create a new plugin instance with undefined manifestPath
    const pluginOptions = {
      browser: 'chrome'
    } as unknown as PluginInterface // Force type to test error case

    plugin = new ApplyManifestDevDefaults(pluginOptions)

    plugin.apply(mockCompiler)

    // Get the processAssets callback
    const processAssetsCallback =
      mockCompilation.hooks.processAssets.tap.mock.calls[0][1]

    // Call the processAssets callback
    processAssetsCallback({})

    // Verify that an error was added to compilation.errors
    expect(mockCompilation.errors).toHaveLength(1)
    expect(mockCompilation.errors[0].message).toContain(
      'No manifest.json found in your extension bundle'
    )
  })

  it('should apply patches for Manifest V2', () => {
    const mockManifest: Manifest = {
      manifest_version: 2,
      name: 'Test Extension',
      version: '1.0.0'
    }

    vi.mocked(utils.getManifestContent).mockReturnValue(mockManifest)
    mockCompilation.getAsset.mockReturnValue(true)

    plugin.apply(mockCompiler)

    // Get the processAssets callback
    const processAssetsCallback =
      mockCompilation.hooks.processAssets.tap.mock.calls[0][1]

    // Call the processAssets callback
    processAssetsCallback({})

    // Verify that updateAsset was called with the patched manifest
    expect(mockCompilation.updateAsset).toHaveBeenCalled()
    const updateAssetCall = mockCompilation.updateAsset.mock.calls[0]
    const patchedManifest = JSON.parse(updateAssetCall[1].source())
    expect(patchedManifest.manifest_version).toBe(2)
    expect(patchedManifest.content_security_policy).toBeDefined()
  })

  it('should apply patches for Manifest V3', () => {
    const mockManifest: Manifest = {
      manifest_version: 3,
      name: 'Test Extension',
      version: '1.0.0'
    }

    vi.mocked(utils.getManifestContent).mockReturnValue(mockManifest)
    mockCompilation.getAsset.mockReturnValue(true)

    plugin.apply(mockCompiler)

    // Get the processAssets callback
    const processAssetsCallback =
      mockCompilation.hooks.processAssets.tap.mock.calls[0][1]

    // Call the processAssets callback
    processAssetsCallback({})

    // Verify that updateAsset was called with the patched manifest
    expect(mockCompilation.updateAsset).toHaveBeenCalled()
    const updateAssetCall = mockCompilation.updateAsset.mock.calls[0]
    const patchedManifest = JSON.parse(updateAssetCall[1].source())
    expect(patchedManifest.manifest_version).toBe(3)
    expect(patchedManifest.content_security_policy).toBeDefined()
    expect(patchedManifest.permissions).toContain('scripting')
  })
})
