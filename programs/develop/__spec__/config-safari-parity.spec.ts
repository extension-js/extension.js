import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest'
import type {SafariPackagerFn, SafariPackagerOverrides} from '../types'

// A reset through a method keeps TypeScript from narrowing the capture to
// undefined for the rest of the function that reset it.
const captured = vi.hoisted(() => {
  type Packager = (
    distPath: string,
    mode: 'full' | 'resync'
  ) => Promise<unknown>
  const state: {devPackager: Packager | undefined} = {devPackager: undefined}

  return {
    state,
    reset() {
      state.devPackager = undefined
    }
  }
})

const rspackMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/config-loader', () => {
  const userConfigSpy = vi.fn((cfg: any) => cfg)

  return {
    loadCustomConfig: vi.fn(async () => userConfigSpy),
    loadConfigResolvedHook: vi.fn(async () => undefined),
    loadBrowserConfig: vi.fn(async () => ({})),
    loadProjectConfigDefaults: vi.fn(async () => ({})),
    loadCommandConfig: vi.fn(async () => ({})),
    userConfigSpy
  }
})

vi.mock('../lib/ensure-develop-artifacts', () => ({
  ensureDevelopArtifacts: vi.fn(async () => {}),
  ensureUserProjectDependencies: vi.fn(async () => {})
}))

vi.mock('../lib/generate-extension-types', () => ({
  generateExtensionTypes: vi.fn(async () => {})
}))

vi.mock('../plugin-js-frameworks/js-tools/typescript', () => ({
  isUsingTypeScript: vi.fn(() => false),
  ensureTypeScriptConfig: vi.fn()
}))

vi.mock('../lib/validate-user-dependencies', () => ({
  assertNoManagedDependencyConflicts: vi.fn()
}))

vi.mock('../plugin-special-folders/folder-extensions/resolve-config', () => ({
  resolveCompanionExtensionsConfig: vi.fn(async () => undefined)
}))

vi.mock('../plugin-special-folders/get-data', () => ({
  getSpecialFoldersDataForProjectRoot: vi.fn(() => ({extensions: undefined})),
  rememberSpecialFoldersConfig: vi.fn()
}))

vi.mock('../rspack-config', () => ({
  default: vi.fn(() => ({plugins: [], output: {}}))
}))

vi.mock('webpack-merge', () => ({merge: (cfg: any) => cfg}))

vi.mock('@rspack/core', () => ({rspack: rspackMock}))

vi.mock('../dev-server', () => ({devServer: vi.fn(async () => {})}))

vi.mock('../plugin-browsers/safari-dev-plugin', () => ({
  SafariDevPlugin: class {
    emitter = {}

    constructor(
      packager: (distPath: string, mode: 'full' | 'resync') => Promise<unknown>
    ) {
      captured.state.devPackager = packager
    }
  }
}))

vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

import {extensionBuild} from '../command-build'
import {extensionDev} from '../command-dev'
import * as devServerMod from '../dev-server'
import * as configLoaderMod from '../lib/config-loader'
import * as projectMod from '../lib/project'

const roots: string[] = []

afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true})
})

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safari-parity-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'dist', 'safari'), {recursive: true})

  return root
}

function pointAt(root: string) {
  vi.spyOn(projectMod, 'getProjectStructure').mockResolvedValue({
    manifestPath: path.join(root, 'manifest.json'),
    packageJsonPath: path.join(root, 'package.json')
  } as any)
}

const greenStats = {hasErrors: () => false, toJson: () => ({})}

function emittingCompiler(config: any) {
  return {
    run: (cb: any) => {
      if (typeof config?.output?.path === 'string') {
        fs.mkdirSync(config.output.path, {recursive: true})
      }

      cb(null, greenStats)
    },
    close: (cb: any) => cb?.()
  }
}

const silentCompiler = {
  run: (cb: any) => cb(null, greenStats),
  close: (cb: any) => cb?.()
}

const commandLayer = {
  appName: 'Command App',
  bundleId: 'com.example.command',
  developmentTeam: 'CMDTEAM01',
  macOsOnly: false,
  forceRegenerate: true,
  safariBinary: '/Applications/Safari Technology Preview.app'
}

const browserLayer = {
  appName: 'Browser App',
  bundleId: 'com.example.browser',
  developmentTeam: 'BRWTEAM01',
  macOsOnly: true,
  forceRegenerate: false,
  safariBinary: '/Applications/Safari.app'
}

const identityKeys = [
  'appName',
  'bundleId',
  'developmentTeam',
  'macOsOnly',
  'forceRegenerate',
  'safariBinary'
] as const

function identityOf(overrides: SafariPackagerOverrides | undefined) {
  return Object.fromEntries(identityKeys.map((key) => [key, overrides?.[key]]))
}

async function buildPackagerInput(root: string) {
  const safariPackager = vi.fn<SafariPackagerFn>(async () => undefined)

  await extensionBuild(root, {
    browser: 'safari',
    silent: true,
    install: false,
    safariPackager
  })

  return safariPackager
}

async function devPackagerInput(root: string) {
  const safariPackager = vi.fn<SafariPackagerFn>(async () => undefined)
  captured.reset()

  await extensionDev(root, {
    browser: 'safari',
    mode: 'development',
    install: false,
    safariPackager
  })

  await captured.state.devPackager?.(path.join(root, 'dist', 'safari'), 'full')

  return safariPackager
}

describe('safari identity, dev versus build', () => {
  beforeEach(() => {
    ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValue({})
    ;(configLoaderMod.loadCommandConfig as any).mockResolvedValue({})
    ;(configLoaderMod as any).userConfigSpy.mockImplementation(
      (cfg: any) => cfg
    )
    ;(devServerMod.devServer as any).mockClear()
    rspackMock.mockReset()
    rspackMock.mockImplementation(emittingCompiler)
  })

  it('hands both packagers the same identity from the command layer', async () => {
    const root = project()
    pointAt(root)
    ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValue(browserLayer)
    ;(configLoaderMod.loadCommandConfig as any).mockResolvedValue(commandLayer)

    const build = await buildPackagerInput(root)
    const dev = await devPackagerInput(root)

    expect(build).toHaveBeenCalledTimes(1)
    expect(dev).toHaveBeenCalledTimes(1)

    const buildIdentity = identityOf(build.mock.calls[0][2])
    const devIdentity = identityOf(dev.mock.calls[0][2])

    expect(buildIdentity).toEqual(commandLayer)
    expect(devIdentity).toEqual(commandLayer)
    expect(buildIdentity.macOsOnly).toBe(false)
  })

  it('hands both packagers the browser layer when no command layer is set', async () => {
    const root = project()
    pointAt(root)
    ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValue(browserLayer)

    const build = await buildPackagerInput(root)
    const dev = await devPackagerInput(root)

    expect(identityOf(build.mock.calls[0][2])).toEqual(browserLayer)
    expect(identityOf(dev.mock.calls[0][2])).toEqual(browserLayer)
  })

  it('accepts a config bundle id whose segment starts with a digit', async () => {
    const root = project()
    pointAt(root)
    ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValue({
      bundleId: 'com.1password.ext'
    })

    const build = await buildPackagerInput(root)

    expect(build).toHaveBeenCalledTimes(1)
    expect(identityOf(build.mock.calls[0][2]).bundleId).toBe(
      'com.1password.ext'
    )
  })

  it('refuses a bundle id from a config layer before any build or server starts', async () => {
    const root = project()
    pointAt(root)
    ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValue({
      bundleId: 'my extension'
    })

    const buildPackager = vi.fn(async () => undefined)

    await expect(
      extensionBuild(root, {
        browser: 'safari',
        silent: true,
        install: false,
        safariPackager: buildPackager
      })
    ).rejects.toThrow(/bundle identifier/)

    expect(buildPackager).not.toHaveBeenCalled()
    expect(rspackMock).not.toHaveBeenCalled()
    ;(configLoaderMod.loadBrowserConfig as any).mockResolvedValue({})
    ;(configLoaderMod.loadCommandConfig as any).mockResolvedValue({
      bundleId: '../../etc/x'
    })

    const devPackager = vi.fn(async () => undefined)

    await expect(
      extensionDev(root, {
        browser: 'safari',
        mode: 'development',
        install: false,
        safariPackager: devPackager
      })
    ).rejects.toThrow(/bundle identifier/)

    expect(devPackager).not.toHaveBeenCalled()
    expect(devServerMod.devServer).not.toHaveBeenCalled()
  })

  it('packages the folder a re-pointed output.path emitted into', async () => {
    const root = project()
    pointAt(root)
    const customOut = path.join(root, 'artifacts', 'web')
    ;(configLoaderMod as any).userConfigSpy.mockImplementation((cfg: any) => ({
      ...cfg,
      output: {...cfg.output, path: customOut}
    }))

    const build = await buildPackagerInput(root)

    expect(build.mock.calls[0][0]).toBe(customOut)
  })

  it('refuses by name when the emitted folder is missing', async () => {
    const root = project()
    pointAt(root)
    const missingOut = path.join(root, 'artifacts', 'missing')
    rspackMock.mockReturnValue(silentCompiler)
    ;(configLoaderMod as any).userConfigSpy.mockImplementation((cfg: any) => ({
      ...cfg,
      output: {...cfg.output, path: missingOut}
    }))

    const safariPackager = vi.fn<SafariPackagerFn>(async () => undefined)

    await expect(
      extensionBuild(root, {
        browser: 'safari',
        silent: true,
        install: false,
        safariPackager
      })
    ).rejects.toThrow(missingOut)

    expect(safariPackager).not.toHaveBeenCalled()
  })
})
