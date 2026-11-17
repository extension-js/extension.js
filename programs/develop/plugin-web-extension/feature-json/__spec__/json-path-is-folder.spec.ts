import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterAll, describe, expect, it} from 'vitest'
import {diagnosticCode} from '../../../lib/diagnostic-code'
import {processJsonAssets} from '../process-assets'

const created = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-json-folder-'))
const root = fs.realpathSync(created)

afterAll(() => {
  fs.rmSync(created, {recursive: true, force: true})
})

function compile(includeList: Record<string, string>) {
  const compilation: any = {
    errors: [],
    warnings: [],
    fileDependencies: new Set<string>(),
    compiler: {options: {context: root}},
    options: {context: root},
    getAsset: () => undefined,
    emitAsset: () => {}
  }

  processJsonAssets(compilation, path.join(root, 'manifest.json'), includeList)

  return compilation
}

describe('a manifest JSON path that is a folder', () => {
  it('fails a ruleset under the code a missing file carries', () => {
    fs.mkdirSync(path.join(root, 'rules'))

    const {errors, warnings} = compile({
      'declarative_net_request/ruleset_1': path.join(root, 'rules')
    })

    expect(warnings).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toBe('manifest.json')
    expect(diagnosticCode(errors[0])).toBe('E_ENTRY_NOT_FOUND')
  })

  it('warns under the same code for a key the browser does not refuse', () => {
    fs.mkdirSync(path.join(root, 'data'))

    const {errors, warnings} = compile({'other/data': path.join(root, 'data')})

    expect(errors).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(diagnosticCode(warnings[0])).toBe('E_ENTRY_NOT_FOUND')
  })
})
