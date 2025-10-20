import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as utils from '../../webpack-lib/utils'
import * as reactMod from '../js-tools/react'

describe('js-tools/react', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.EXTENSION_ENV = 'development'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('isUsingReact returns true when dependency exists and logs once', () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    const spyLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const first = reactMod.isUsingReact('/p')
    const second = reactMod.isUsingReact('/p')
    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(spyLog).toHaveBeenCalledTimes(1)
  })

  it('maybeUseReact returns alias map and plugin when dependencies are present', async () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    vi.mock('@rspack/plugin-react-refresh', () => ({default: class {}}))
    vi.stubGlobal('require', {
      resolve: (id: string) => (id ? '/ok' : '')
    } as any)

    // Create a temp project with node_modules structure to let createRequire resolve
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'react-spec-'))
    const nm = path.join(tmp, 'node_modules')
    fs.mkdirSync(path.join(nm, 'react'), {recursive: true})
    fs.mkdirSync(path.join(nm, 'react-dom', 'client'), {recursive: true})
    fs.writeFileSync(path.join(nm, 'react', 'index.js'), '', 'utf8')
    fs.writeFileSync(path.join(nm, 'react-dom', 'index.js'), '', 'utf8')
    fs.writeFileSync(
      path.join(nm, 'react-dom', 'client', 'index.js'),
      '',
      'utf8'
    )
    fs.mkdirSync(path.join(nm, 'react', 'jsx-runtime'), {recursive: true})
    fs.writeFileSync(
      path.join(nm, 'react', 'jsx-runtime', 'index.js'),
      '',
      'utf8'
    )
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}', 'utf8')

    const res = await reactMod.maybeUseReact(tmp)
    expect(res?.plugins?.length).toBe(1)
    expect(res?.alias?.['react$']).toContain('/react/')
    expect(res?.alias?.['react-dom$']).toContain('/react-dom/')
    expect(res?.alias?.['react-dom/client']).toContain('/react-dom/')
    expect(res?.alias?.['react/jsx-runtime']).toContain('/react/jsx-runtime')
  })

  it('maybeUseReact installs deps and exits when react-refresh missing', async () => {
    vi.spyOn(utils, 'hasDependency').mockReturnValue(true)
    const install = vi
      .spyOn(utils, 'installOptionalDependencies')
      .mockResolvedValue(undefined as any)

    // Force require.resolve('react-refresh') to throw even if installed
    const Module = require('module')
    const orig = Module._resolveFilename
    vi.spyOn(Module as any, '_resolveFilename').mockImplementation(
      (request: string, parent: any, isMain: any, options: any) => {
        if (request === 'react-refresh') throw new Error('nf')
        return orig.call(Module, request, parent, isMain, options)
      }
    )

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as any)

    await expect(reactMod.maybeUseReact('/p')).rejects.toThrow('exit')
    expect(install).toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
    expect(exit).toHaveBeenCalled()
  })
})
