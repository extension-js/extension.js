import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'

vi.mock('fs', async () => {
  const actual = await vi.importActual<any>('fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn()
  }
})

vi.mock('../webpack-lib/project', () => ({
  getProjectStructure: vi.fn(async () => ({
    manifestPath: '/proj/manifest.json',
    packageJsonPath: '/proj/package.json'
  }))
}))

vi.mock('../dev-server', () => {
  const devServer = vi.fn(async () => {})
  return {devServer}
})

vi.mock('../webpack-lib/generate-extension-types', () => {
  const generateExtensionTypes = vi.fn(async () => {})
  return {generateExtensionTypes}
})

vi.mock('../webpack-lib/validate-user-dependencies', () => ({
  assertNoManagedDependencyConflicts: vi.fn()
}))

vi.mock('../webpack-lib/dependency-manager', () => ({
  ensureProjectReady: vi.fn(async () => ({
    installed: false,
    installedBuild: false,
    installedUser: false
  }))
}))

vi.mock('../plugin-js-frameworks/js-tools/typescript', () => ({
  isUsingTypeScript: vi.fn(() => true)
}))

import {extensionDev} from '../command-dev'
import * as devServerMod from '../dev-server'
import * as genTypesMod from '../webpack-lib/generate-extension-types'
import * as depsManagerMod from '../webpack-lib/dependency-manager'

describe('webpack/command-dev', () => {
  // fs is mocked module - configure per-test behaviors via mockImplementation
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.resetModules()
    ;(devServerMod as any).devServer?.mockClear?.()
    ;(genTypesMod as any).generateExtensionTypes?.mockClear?.()
    ;(depsManagerMod as any).ensureProjectReady?.mockClear?.()
    ;(fs.existsSync as any)?.mockReset?.()
    ;(fs.readdirSync as any)?.mockReset?.()
    logSpy.mockClear()
    errorSpy.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('generates types for TS projects, installs dependencies if needed, and starts dev server with defaults', async () => {
    // Simulate missing node_modules
    const nodeModules = path.join('/proj', 'node_modules')
    ;(fs.existsSync as any).mockImplementation((p: fs.PathLike) =>
      String(p) === nodeModules ? false : false
    )
    ;(fs.readdirSync as any).mockReturnValue([])

    await extensionDev('/proj', {browser: undefined, port: 0} as any)

    expect(genTypesMod.generateExtensionTypes).toHaveBeenCalledWith(
      '/proj',
      '/proj'
    )
    expect(depsManagerMod.ensureProjectReady).toHaveBeenCalled()
    expect(devServerMod.devServer).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({mode: 'development', browser: 'chrome'})
    )
  })

  it('exits process(1) on unexpected error', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      // @ts-ignore
      .mockImplementation(() => {
        throw new Error('exit 1')
      })

    ;(devServerMod as any).devServer.mockImplementationOnce(async () => {
      throw new Error('boom')
    })

    await expect(
      extensionDev('/proj', {browser: 'firefox'} as any)
    ).rejects.toThrow('exit 1')
    exitSpy.mockRestore()
  })
})
