import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as utils from '../../webpack-lib/utils'
import * as vueMod from '../js-tools/vue'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

describe('js-tools/vue', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.EXTENSION_ENV = 'development'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isUsingVue returns true when dependency exists and logs once', () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const first = vueMod.isUsingVue('/p')
    const second = vueMod.isUsingVue('/p')
    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(spyLog).toHaveBeenCalledTimes(1)
  })

  it('maybeUseVue returns loader and plugin when resolvable, includes custom options and logs when custom loader file exists', async () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    vi.stubGlobal('require', {resolve: () => '/ok'} as any)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vue-spec-'))
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8')
    fs.writeFileSync(
      path.join(tmp, 'vue.loader.js'),
      'module.exports={custom:true}',
      'utf8'
    )
    // loadLoaderOptions real path
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await vueMod.maybeUseVue(tmp)
    expect(res?.plugins?.length).toBe(1)
    expect(res?.loaders?.[0]?.loader).toContain('vue-loader')
    expect((res?.loaders?.[0] as any)?.options?.custom).toBe(true)
    expect(log).toHaveBeenCalled()
  })

  it('maybeUseVue installs deps and exits when loader missing', async () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    const install = vi
      .spyOn(utils, 'installOptionalDependencies')
      .mockResolvedValue(undefined as any)
    const Module = require('module')
    const orig = Module._resolveFilename
    vi.spyOn(Module as any, '_resolveFilename').mockImplementation(
      (request: string, parent: any, isMain: any, options: any) => {
        if (request === 'vue-loader') throw new Error('nf')
        return orig.call(Module, request, parent, isMain, options)
      }
    )

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as any)

    await expect(vueMod.maybeUseVue('/p')).rejects.toThrow('exit')
    expect(install).toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
    expect(exit).toHaveBeenCalled()
  })
})
