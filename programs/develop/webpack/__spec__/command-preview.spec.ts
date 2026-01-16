import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
  return {
    ...actual,
    existsSync: vi.fn()
  }
})

vi.mock('../webpack-lib/project', () => ({
  getProjectStructure: vi.fn(async () => ({
    manifestPath: '/proj/manifest.json',
    packageJsonPath: '/proj/package.json'
  }))
}))

vi.mock('../webpack-lib/config-loader', () => ({
  loadCommandConfig: vi.fn(async () => ({})),
  loadBrowserConfig: vi.fn(async () => ({}))
}))

vi.mock('../webpack-lib/validate-user-dependencies', () => ({
  assertNoManagedDependencyConflicts: vi.fn()
}))

vi.mock('../webpack-lib/companion-extensions', () => ({
  resolveCompanionExtensionDirs: vi.fn(() => ['/comp/a'])
}))

vi.mock('../webpack-lib/extensions-to-load', () => ({
  computeExtensionsToLoad: vi.fn(() => ['/theme', '/comp/a', '/out'])
}))

vi.mock('../webpack-lib/dark-mode', () => ({
  withDarkMode: vi.fn(({browserFlags, preferences}: any) => ({
    browserFlags,
    preferences
  }))
}))

const runOnlyPreviewBrowser = vi.fn(async () => {})
vi.mock('../plugin-browsers/run-only', () => ({
  runOnlyPreviewBrowser: (...args: any[]) => runOnlyPreviewBrowser(...args)
}))

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

import {extensionPreview} from '../command-preview'

describe('webpack/command-preview (run-only)', () => {
  beforeEach(() => {
    vi.resetModules()
    runOnlyPreviewBrowser.mockClear()
    logSpy.mockClear()
    ;(fs.existsSync as any)?.mockReset?.()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to manifest directory when dist/<browser> lacks manifest.json', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json')) return false
      if (p === path.join('/proj', 'manifest.json')) return true
      return false
    })

    await extensionPreview('/proj', {browser: 'chrome'} as any)

    expect(runOnlyPreviewBrowser).toHaveBeenCalledTimes(1)
    const call = runOnlyPreviewBrowser.mock.calls[0][0]
    expect(call.outPath).toBe('/proj')
  })

  it('uses dist/<browser> when dist manifest exists', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json')) return true
      return false
    })

    await extensionPreview('/proj', {browser: 'chrome'} as any)

    expect(runOnlyPreviewBrowser).toHaveBeenCalledTimes(1)
    const call = runOnlyPreviewBrowser.mock.calls[0][0]
    expect(call.outPath).toBe(path.join('/proj', 'dist', 'chrome'))
  })

  it('throws when outputPath does not contain manifest.json', async () => {
    ;(fs.existsSync as any).mockImplementation(() => false)

    await expect(
      extensionPreview('/proj', {browser: 'chrome'} as any)
    ).rejects.toThrow(/Preview is run-only and does not compile/)

    expect(runOnlyPreviewBrowser).not.toHaveBeenCalled()
  })
})
