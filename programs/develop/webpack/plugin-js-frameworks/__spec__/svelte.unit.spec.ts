import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as utils from '../../webpack-lib/utils'
import * as svelteMod from '../js-tools/svelte'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

describe('js-tools/svelte', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.EXTENSION_ENV = 'development'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isUsingSvelte returns true when dependency exists and logs once', () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const first = svelteMod.isUsingSvelte('/p')
    const second = svelteMod.isUsingSvelte('/p')
    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(spyLog).toHaveBeenCalledTimes(1)
  })

  it('maybeUseSvelte returns loaders and resolver plugin when deps resolvable', async () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    vi.stubGlobal('require', {
      resolve: (id: string) => (id ? '/ok' : '')
    } as any)

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'svelte-spec-'))
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8')
    fs.writeFileSync(
      path.join(tmp, 'svelte.loader.js'),
      'module.exports={custom:true}',
      'utf8'
    )

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await svelteMod.maybeUseSvelte(tmp, 'development')
    expect(res?.loaders?.length).toBeGreaterThan(0)
    expect((res?.loaders?.[1] as any)?.use?.options?.custom).toBe(true)
    expect(res?.plugins?.length).toBe(1)
    expect(log).toHaveBeenCalled()
  })

  it('maybeUseSvelte installs deps and exits when loader missing', async () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    const install = vi
      .spyOn(utils, 'installOptionalDependencies')
      .mockResolvedValue(undefined as any)

    const Module = require('module')
    const orig = Module._resolveFilename
    vi.spyOn(Module as any, '_resolveFilename').mockImplementation(
      (request: string, parent: any, isMain: any, options: any) => {
        if (request === 'svelte-loader' || request === 'typescript') {
          throw new Error('nf')
        }
        return orig.call(Module, request, parent, isMain, options)
      }
    )

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as any)

    await expect(svelteMod.maybeUseSvelte('/p', 'development')).rejects.toThrow(
      'exit'
    )
    expect(install).toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
    expect(exit).toHaveBeenCalled()
  })
})
