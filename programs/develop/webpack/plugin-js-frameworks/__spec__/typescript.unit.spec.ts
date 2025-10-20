import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as tsMod from '../js-tools/typescript'
import * as utils from '../../webpack-lib/utils'

describe('js-tools/typescript', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.EXTENSION_ENV = 'development'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getUserTypeScriptConfigFile finds local tsconfig.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-spec-'))
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), '{}', 'utf8')
    const res = tsMod.getUserTypeScriptConfigFile(tmp)
    expect(res).toBe(path.join(tmp, 'tsconfig.json'))
  })

  it('isUsingTypeScript returns true when tsconfig exists and deps/files are present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-spec-'))
    fs.mkdirSync(path.join(tmp, 'src'))
    fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'export{}', 'utf8')
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), '{}', 'utf8')
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({devDependencies: {typescript: '^5'}}),
      'utf8'
    )

    const res = tsMod.isUsingTypeScript(tmp)
    expect(res).toBe(true)
  })

  it('defaultTypeScriptConfig enables react-jsx if JS framework is present', () => {
    vi.doMock('../../webpack-lib/utils', () => ({
      isUsingJSFramework: () => true
    }))
    // Reload module to pick mock
    return import('../js-tools/typescript').then((fresh) => {
      const cfg = fresh.defaultTypeScriptConfig('/proj')
      expect(cfg.compilerOptions.jsx).toBe('react-jsx')
    })
  })

  it('maybeUseTypeScript installs and exits when typescript is not resolvable', async () => {
    vi.spyOn(utils, 'installOptionalDependencies').mockResolvedValue(
      undefined as any
    )
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-spec-'))
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({devDependencies: {typescript: '^5'}}),
      'utf8'
    )
    // Ensure isUsingTypeScript(projectPath) returns true
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), '{}', 'utf8')
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as any)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const Module = require('module')
    const orig = Module._resolveFilename
    vi.spyOn(Module as any, '_resolveFilename').mockImplementation(
      (request: string, parent: any, isMain: any, options: any) => {
        if (request === 'typescript') throw new Error('nf')
        return orig.call(Module, request, parent, isMain, options)
      }
    )

    await expect(tsMod.maybeUseTypeScript(tmp)).rejects.toThrow('exit')
    expect(exit).toHaveBeenCalled()
    expect(log).toHaveBeenCalled()
  })
})
