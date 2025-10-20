import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as utils from '../../webpack-lib/utils'
import * as preactMod from '../js-tools/preact'

describe('js-tools/preact', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.EXTENSION_ENV = 'development'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isUsingPreact returns true when dependency exists and logs once', () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)

    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const first = preactMod.isUsingPreact('/p')
    const second = preactMod.isUsingPreact('/p')
    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(spyLog).toHaveBeenCalledTimes(1)
  })

  it('maybeUsePreact returns alias and plugin when dependencies are available', async () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    // Mock the optional plugin module so the top-level import does not fail in module body
    vi.mock('@rspack/plugin-preact-refresh', () => ({default: class {}}))
    // Provide a minimal global require with resolve that succeeds
    vi.stubGlobal('require', {resolve: () => '/ok'} as any)

    const res = await preactMod.maybeUsePreact('/p')
    expect(res?.alias?.react).toBe('preact/compat')
    expect(res?.plugins?.length).toBe(1)
  })

  it('maybeUsePreact installs dependencies and exits when not resolvable', async () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    const install = vi
      .spyOn(utils, 'installOptionalDependencies')
      .mockResolvedValue(undefined as any)

    // Force require.resolve('@rspack/plugin-preact-refresh') to throw
    const Module = require('module')
    const orig = Module._resolveFilename
    vi.spyOn(Module as any, '_resolveFilename').mockImplementation(
      (request: string, parent: any, isMain: any, options: any) => {
        if (request === '@rspack/plugin-preact-refresh') throw new Error('nf')
        return orig.call(Module, request, parent, isMain, options)
      }
    )

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as any)

    await expect(preactMod.maybeUsePreact('/p')).rejects.toThrow('exit')
    expect(install).toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
    expect(exit).toHaveBeenCalled()
  })
})
