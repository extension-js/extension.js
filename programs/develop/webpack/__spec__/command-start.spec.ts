import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'

vi.mock('../webpack-lib/project', () => ({
  getProjectStructure: vi.fn(async () => ({
    manifestPath: '/proj/dir/manifest.json',
    packageJsonPath: '/proj/dir/package.json'
  }))
}))

vi.mock('../command-build', () => {
  const extensionBuild = vi.fn(async () => ({browser: 'chrome'}))
  return {extensionBuild}
})
vi.mock('../command-preview', () => {
  const extensionPreview = vi.fn(async () => {})
  return {extensionPreview}
})

vi.mock('../webpack-lib/config-loader', () => ({
  loadCommandConfig: vi.fn(async () => ({fromCommand: true})),
  loadBrowserConfig: vi.fn(async () => ({fromBrowser: true}))
}))

import {extensionStart} from '../command-start'
import * as buildMod from '../command-build'
import * as previewMod from '../command-preview'

describe('webpack/command-start', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(buildMod as any).extensionBuild?.mockClear?.()
    ;(previewMod as any).extensionPreview?.mockClear?.()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('composes build (silent) then preview from dist/<browser> and merges options', async () => {
    await extensionStart('/proj/dir', {browser: 'chrome', some: 'x'} as any)

    expect(buildMod.extensionBuild).toHaveBeenCalledWith(
      '/proj/dir',
      expect.objectContaining({
        browser: 'chrome',
        silent: true,
        fromBrowser: true,
        fromCommand: true
      })
    )

    const expectedOutputPath = path.join('/proj/dir', 'dist', 'chrome')
    expect(previewMod.extensionPreview).toHaveBeenCalledWith(
      '/proj/dir',
      expect.objectContaining({
        browser: 'chrome',
        outputPath: expectedOutputPath,
        fromBrowser: true,
        fromCommand: true
      })
    )
  })
})
