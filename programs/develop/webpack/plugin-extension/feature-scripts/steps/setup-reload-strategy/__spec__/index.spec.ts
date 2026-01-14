import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as fs from 'fs'

vi.mock('fs', () => ({
  readFileSync: vi.fn()
}))
vi.mock('../../../scripts-lib/manifest', () => ({
  filterKeysForThisBrowser: (m: any) => m
}))
const applyManifestSpy = vi.fn()
const setupBgSpy = vi.fn()

vi.mock('../apply-manifest-dev-defaults', () => ({
  ApplyManifestDevDefaults: vi.fn().mockImplementation(function () {
    this.apply = applyManifestSpy
  })
}))
vi.mock('../setup-background-entry', () => ({
  SetupBackgroundEntry: vi.fn().mockImplementation(function () {
    this.apply = setupBgSpy
  })
}))

const webExtSpy = vi.fn()
// SetupReloadStrategy imports a local fork (`../webpack-target-webextension-fork`),
// so we mock that module to avoid needing a full Webpack/Rspack compiler stub here.
vi.mock('../webpack-target-webextension-fork', () => ({
  default: vi.fn().mockImplementation(function (opts: any) {
    webExtSpy(opts)
    this.apply = vi.fn()
  })
}))

import {SetupReloadStrategy} from '..'

const setManifest = (obj: any) => {
  ;(fs.readFileSync as unknown as any).mockReturnValueOnce(JSON.stringify(obj))
}

const makeCompiler = () => ({options: {mode: 'development'}}) as any

describe('SetupReloadStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses serviceWorkerEntry for MV3 background', () => {
    setManifest({manifest_version: 3, background: {service_worker: 'sw.js'}})
    const plugin = new SetupReloadStrategy({manifestPath: '/abs/m.json'} as any)
    plugin.apply(makeCompiler())
    expect(webExtSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        background: expect.objectContaining({
          serviceWorkerEntry: 'background/service_worker'
        })
      })
    )
    expect(applyManifestSpy).toHaveBeenCalled()
    expect(setupBgSpy).toHaveBeenCalled()
  })

  it('uses pageEntry for MV2 classic background and gecko', () => {
    setManifest({manifest_version: 2, background: {scripts: ['bg.js']}})
    const plugin = new SetupReloadStrategy({
      manifestPath: '/abs/m.json',
      browser: 'firefox'
    } as any)
    plugin.apply(makeCompiler())
    expect(webExtSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        background: expect.objectContaining({pageEntry: 'background/script'})
      })
    )
  })
})

