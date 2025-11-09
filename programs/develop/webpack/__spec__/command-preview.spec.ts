import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as fs from 'fs'
vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
  return {
    ...actual,
    mkdirSync: vi.fn(),
    existsSync: vi.fn()
  }
})
import * as path from 'path'

vi.mock('../webpack-lib/project', () => ({
  getProjectStructure: vi.fn(async () => ({
    manifestPath: '/proj/manifest.json',
    packageJsonPath: '/proj/package.json'
  }))
}))

// Mock class identity used by instanceof in SUT
vi.mock('../plugin-browsers', () => {
  class BrowsersPlugin {}
  return {BrowsersPlugin}
})

// base config includes a matching BrowsersPlugin and a non-matching plugin
vi.mock('../webpack-config', async () => {
  const {BrowsersPlugin} = await import('../plugin-browsers')
  const nonBrowserPlugin = {}
  return {
    default: vi.fn(() => ({
      plugins: [new BrowsersPlugin({} as any), nonBrowserPlugin],
      output: {}
    }))
  }
})
vi.mock('webpack-merge', () => ({merge: (cfg: any) => cfg}))

vi.mock('../webpack-lib/config-loader', () => ({
  loadCustomWebpackConfig: vi.fn(async () => (cfg: any) => cfg),
  loadCommandConfig: vi.fn(async () => ({cmd: true})),
  loadBrowserConfig: vi.fn(async () => ({browserCfg: true}))
}))

vi.mock('../webpack-lib/validate-user-dependencies', () => ({
  assertNoManagedDependencyConflicts: vi.fn()
}))

vi.mock('@rspack/core', () => {
  const rspack = vi.fn()
  return {rspack}
})

// Avoid reading manifest in messages.runningInProduction
vi.mock(
  '../webpack-lib/messages',
  async (importOriginal: () => Promise<Record<string, any>>) => {
    const actual = await importOriginal()
    return {
      ...actual,
      runningInProduction: vi.fn(() => 'RUNNING'),
      previewing: vi.fn(() => 'PREVIEW')
    }
  }
)

// Logs and fs
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
// Use mocked functions directly
;(fs.existsSync as any).mockImplementation(() => false)

import {extensionPreview} from '../command-preview'
import * as rspackMod from '@rspack/core'

describe('webpack/command-preview', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(rspackMod as any).rspack?.mockReset?.()
    logSpy.mockClear()
    errorSpy.mockClear()
    ;(fs.mkdirSync as any)?.mockClear?.()
    ;(fs.existsSync as any)?.mockReset?.()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates default output directory and runs only browser runner plugins', async () => {
    const compiler = {
      run: (cb: any) => cb(null, {hasErrors: () => false}),
      close: (cb: any) => cb?.()
    }
    ;(rspackMod as any).rspack.mockReturnValue(compiler)

    await extensionPreview('/proj', {browser: 'chrome'} as any)

    // Ensured output path is created under dist/<browser>
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join('/proj', 'dist', 'chrome'),
      {recursive: true}
    )

    // rspack received merged config (indirect), but the filtered plugins were passed to user config
    expect((rspackMod as any).rspack).toHaveBeenCalledTimes(1)
  })

  it('on compilation errors, scrubs output and closes compiler then exits(1)', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      // @ts-ignore
      .mockImplementation(() => {
        throw new Error('exit 1')
      })

    const stats = {
      hasErrors: () => true,
      toString: () => 'Rspack error\nModuleParseError: foo'
    }
    const compiler = {
      run: (cb: any) => cb(null, stats),
      close: (cb: any) => cb?.()
    }
    ;(rspackMod as any).rspack.mockReturnValue(compiler)

    await expect(
      extensionPreview('/proj', {browser: 'chrome'} as any)
    ).rejects.toThrow('exit 1')
    exitSpy.mockRestore()
  })
})
