import * as fs from 'fs'
import * as utils from '../../../../lib/utils'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import {AddPublicPathForMainWorld} from '../../steps/add-public-path-for-main-world'
import {type Compiler} from '@rspack/core'

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn()
}))

// Mock utils module
vi.mock('../../../../lib/utils', () => ({
  filterKeysForThisBrowser: vi.fn()
}))

// Mock process.exit
vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

describe('AddPublicPathForMainWorld', () => {
  const mockManifestPath = '/mock/manifest.json'
  const mockProjectPath = '/mock'
  const mockResourcePath = '/mock/content.js'

  const mockCompiler = {
    options: {
      entry: {}
    }
  } as unknown as Compiler

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        name: 'test-extension'
      })
    )
    vi.mocked(utils.filterKeysForThisBrowser).mockImplementation(
      (manifest) => manifest
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should handle manifest without content scripts', () => {
    const manifest = {
      name: 'test-extension'
    }
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest))

    const addPublicPath = new AddPublicPathForMainWorld({
      manifestPath: mockManifestPath
    })
    addPublicPath.apply(mockCompiler)

    expect(utils.filterKeysForThisBrowser).toHaveBeenCalledWith(
      manifest,
      'chrome'
    )
  })

  it('should handle manifest with content scripts but no main world', () => {
    const manifest = {
      name: 'test-extension',
      content_scripts: [
        {
          js: ['content.js']
        }
      ]
    }
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest))

    const addPublicPath = new AddPublicPathForMainWorld({
      manifestPath: mockManifestPath
    })
    addPublicPath.apply(mockCompiler)

    expect(utils.filterKeysForThisBrowser).toHaveBeenCalledWith(
      manifest,
      'chrome'
    )
  })

  it('should handle manifest with main world content scripts and extension key', () => {
    const manifest = {
      name: 'test-extension',
      key: 'test-key',
      content_scripts: [
        {
          js: ['content.js'],
          world: 'MAIN'
        }
      ]
    }
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest))

    const addPublicPath = new AddPublicPathForMainWorld({
      manifestPath: mockManifestPath
    })
    addPublicPath.apply(mockCompiler)

    expect(utils.filterKeysForThisBrowser).toHaveBeenCalledWith(
      manifest,
      'chrome'
    )
  })

  it('should throw error for chromium browsers without extension key', () => {
    const manifest = {
      name: 'test-extension',
      content_scripts: [
        {
          js: ['content.js'],
          world: 'MAIN'
        }
      ]
    }

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest))
    vi.mocked(utils.filterKeysForThisBrowser).mockReturnValue(manifest)

    const addPublicPath = new AddPublicPathForMainWorld({
      manifestPath: mockManifestPath
    })
    expect(() => addPublicPath.apply(mockCompiler)).toThrow()
  })

  it('should not throw error for non-chromium browsers without extension key', () => {
    const manifest = {
      name: 'test-extension',
      content_scripts: [
        {
          js: ['content.js'],
          world: 'MAIN'
        }
      ]
    }
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest))
    vi.mocked(utils.filterKeysForThisBrowser).mockImplementation(() => ({
      name: 'test-extension',
      content_scripts: [
        {
          js: ['content.js'],
          world: 'MAIN'
        }
      ]
    }))

    const addPublicPath = new AddPublicPathForMainWorld({
      manifestPath: mockManifestPath,
      browser: 'firefox'
    })
    expect(() => addPublicPath.apply(mockCompiler)).not.toThrow()
  })

  it('should handle manifest with mixed content scripts', () => {
    const manifest = {
      name: 'test-extension',
      key: 'test-key',
      content_scripts: [
        {
          js: ['content1.js'],
          world: 'MAIN'
        },
        {
          js: ['content2.js']
        }
      ]
    }
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(manifest))

    const addPublicPath = new AddPublicPathForMainWorld({
      manifestPath: mockManifestPath
    })
    addPublicPath.apply(mockCompiler)

    expect(utils.filterKeysForThisBrowser).toHaveBeenCalledWith(
      manifest,
      'chrome'
    )
  })
})
