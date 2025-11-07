import {describe, it, expect, vi, beforeEach} from 'vitest'

vi.mock('fs', () => ({
  existsSync: () => true,
  lstatSync: () => ({isFile: () => true})
}))
vi.mock('../steps/add-scripts', () => ({
  AddScripts: vi.fn().mockImplementation(function () {
    this.apply = vi.fn()
  })
}))
vi.mock('../steps/setup-reload-strategy/add-content-script-wrapper', () => ({
  AddContentScriptWrapper: vi.fn().mockImplementation(function () {
    this.apply = vi.fn()
  })
}))
vi.mock('../steps/add-public-path-runtime-module', () => ({
  AddPublicPathRuntimeModule: vi.fn().mockImplementation(function () {
    this.apply = vi.fn()
  })
}))
vi.mock('../steps/setup-reload-strategy', () => ({
  SetupReloadStrategy: vi.fn().mockImplementation(function () {
    this.apply = vi.fn()
  })
}))
vi.mock('../steps/throw-if-manifest-scripts-change', () => ({
  ThrowIfManifestScriptsChange: vi.fn().mockImplementation(function () {
    this.apply = vi.fn()
  })
}))

import {ScriptsPlugin} from '..'
import {AddScripts} from '../steps/add-scripts'
import {AddContentScriptWrapper} from '../steps/setup-reload-strategy/add-content-script-wrapper'
import {AddPublicPathRuntimeModule} from '../steps/add-public-path-runtime-module'
import {SetupReloadStrategy} from '../steps/setup-reload-strategy'
import {ThrowIfManifestScriptsChange} from '../steps/throw-if-manifest-scripts-change'

const makeCompiler = (mode: 'development' | 'production') =>
  ({options: {mode}}) as any

describe('ScriptsPlugin wiring', () => {
  beforeEach(() => vi.clearAllMocks())

  it('early-returns when manifest path is invalid', () => {
    const plugin = new ScriptsPlugin({manifestPath: ''} as any)
    const compiler = makeCompiler('development')
    plugin.apply(compiler)
    expect((AddScripts as any).mock.calls.length).toBe(0)
    expect((AddContentScriptWrapper as any).mock.calls.length).toBe(0)
    expect((AddPublicPathRuntimeModule as any).mock.calls.length).toBe(0)
    expect((SetupReloadStrategy as any).mock.calls.length).toBe(0)
    expect((ThrowIfManifestScriptsChange as any).mock.calls.length).toBe(0)
  })

  it('applies production steps: AddScripts, AddContentScriptWrapper, AddPublicPathRuntimeModule', () => {
    const fs = require('fs')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'lstatSync').mockReturnValue({isFile: () => true} as any)

    const plugin = new ScriptsPlugin({
      manifestPath: '/abs/manifest.json'
    } as any)
    const compiler = makeCompiler('production')
    plugin.apply(compiler)

    expect(AddScripts).toHaveBeenCalled()
    expect(AddContentScriptWrapper).toHaveBeenCalled()
    expect(AddPublicPathRuntimeModule).toHaveBeenCalled()
    expect(SetupReloadStrategy).not.toHaveBeenCalled()
    expect(ThrowIfManifestScriptsChange).not.toHaveBeenCalled()
  })

  it('applies development steps: AddScripts, AddContentScriptWrapper, SetupReloadStrategy, ThrowIfManifestScriptsChange', () => {
    const fs = require('fs')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'lstatSync').mockReturnValue({isFile: () => true} as any)

    const plugin = new ScriptsPlugin({
      manifestPath: '/abs/manifest.json'
    } as any)
    const compiler = makeCompiler('development')
    plugin.apply(compiler)

    expect(AddScripts).toHaveBeenCalled()
    expect(AddContentScriptWrapper).toHaveBeenCalled()
    expect(SetupReloadStrategy).toHaveBeenCalled()
    expect(ThrowIfManifestScriptsChange).toHaveBeenCalled()
    expect(AddPublicPathRuntimeModule).not.toHaveBeenCalled()
  })
})
