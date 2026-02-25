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

vi.mock('../feature-special-folders/folder-extensions/resolve-dirs', () => ({
  resolveCompanionExtensionDirs: vi.fn(() => ['/comp/a'])
}))
vi.mock('../feature-special-folders/folder-extensions/resolve-config', () => ({
  resolveCompanionExtensionsConfig: vi.fn(async () => ({paths: ['/comp/a']}))
}))
vi.mock('../feature-special-folders/get-data', () => ({
  getSpecialFoldersDataForProjectRoot: vi.fn(() => ({extensions: undefined}))
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

const runOnlyPreviewBrowser = vi.fn(async (..._args: any[]) => {})
vi.mock('../plugin-browsers/run-only', () => ({
  runOnlyPreviewBrowser: (...args: any[]) => runOnlyPreviewBrowser(...args)
}))

const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

import {extensionPreview} from '../command-preview'
import * as resolveConfigMod from '../feature-special-folders/folder-extensions/resolve-config'
import * as resolveDirsMod from '../feature-special-folders/folder-extensions/resolve-dirs'
import * as extensionsToLoadMod from '../webpack-lib/extensions-to-load'

describe('webpack/command-preview (run-only)', () => {
  beforeEach(() => {
    vi.resetModules()
    runOnlyPreviewBrowser.mockClear()
    logSpy.mockClear()
    ;(fs.existsSync as any)?.mockReset?.()
    ;(resolveConfigMod as any).resolveCompanionExtensionsConfig?.mockClear?.()
    ;(resolveDirsMod as any).resolveCompanionExtensionDirs?.mockClear?.()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to manifest directory when dist/<browser> lacks manifest.json', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return false
      if (p === path.join('/proj', 'manifest.json')) return true
      return false
    })

    await extensionPreview('/proj', {browser: 'chrome'} as any)

    expect(runOnlyPreviewBrowser).toHaveBeenCalledTimes(1)
    const call = runOnlyPreviewBrowser.mock.calls[0]?.[0] as any
    expect(call.outPath).toBe('/proj')
  })

  it('uses dist/<browser> when dist manifest exists', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview('/proj', {browser: 'chrome'} as any)

    expect(runOnlyPreviewBrowser).toHaveBeenCalledTimes(1)
    const call = runOnlyPreviewBrowser.mock.calls[0]?.[0] as any
    expect(call.outPath).toBe(path.join('/proj', 'dist', 'chrome'))
  })

  it('throws when outputPath does not contain manifest.json', async () => {
    ;(fs.existsSync as any).mockImplementation(() => false)

    await expect(
      extensionPreview('/proj', {browser: 'chrome'} as any)
    ).rejects.toThrow(/Preview is run-only and does not compile/)

    expect(runOnlyPreviewBrowser).not.toHaveBeenCalled()
  })

  it('skips browser runner when noRunner is true', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview('/proj', {
      browser: 'chrome',
      noRunner: true
    } as any)

    expect(runOnlyPreviewBrowser).not.toHaveBeenCalled()
  })

  it('resolves companion extensions before scanning', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    await extensionPreview('/proj', {
      browser: 'chrome',
      extensions: [
        'https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi'
      ]
    } as any)

    expect(
      resolveConfigMod.resolveCompanionExtensionsConfig
    ).toHaveBeenCalledWith({
      projectRoot: '/proj',
      browser: 'chrome',
      config: [
        'https://chromewebstore.google.com/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi'
      ]
    })
    expect(resolveDirsMod.resolveCompanionExtensionDirs).toHaveBeenCalledWith(
      expect.objectContaining({config: {paths: ['/comp/a']}})
    )
  })

  it('passes built-in devtools + theme + user output to preview runner', async () => {
    ;(fs.existsSync as any).mockImplementation((p: string) => {
      if (p === path.join('/proj', 'dist', 'chrome', 'manifest.json'))
        return true
      return false
    })

    ;(extensionsToLoadMod.computeExtensionsToLoad as any).mockReturnValue([
      '/builtins/devtools',
      '/builtins/theme',
      '/comp/a',
      '/proj/dist/chrome'
    ])

    await extensionPreview('/proj', {browser: 'chrome'} as any)

    expect(extensionsToLoadMod.computeExtensionsToLoad).toHaveBeenCalledWith(
      expect.any(String),
      'production',
      'chrome',
      '/proj/dist/chrome',
      ['/comp/a'],
      '/proj/manifest.json'
    )
    expect(runOnlyPreviewBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionsToLoad: [
          '/builtins/devtools',
          '/builtins/theme',
          '/comp/a',
          '/proj/dist/chrome'
        ]
      })
    )
  })
})
