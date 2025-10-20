import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, beforeEach, afterEach} from 'vitest'
import {SetupBackgroundEntry} from '../steps/setup-reload-strategy/setup-background-entry'

function createCompiler() {
  return {options: {entry: {}}} as any
}

describe('SetupBackgroundEntry', () => {
  let tmp: string
  let manifestPath: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-'))
    manifestPath = path.join(tmp, 'manifest.json')
  })
  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it('adds default entry for MV3 when service_worker not present', () => {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3, background: {}})
    )
    const compiler = createCompiler()
    const step = new SetupBackgroundEntry({manifestPath})
    step.apply(compiler)
    expect(compiler.options.entry['background/service_worker']).toBeTruthy()
  })

  it('pushes compilation error when declared background file is missing', () => {
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 2, background: {scripts: ['bg.js']}})
    )
    const compiler = createCompiler()
    const step = new SetupBackgroundEntry({manifestPath})
    // simulate compilation pipeline to collect errors from hook
    const compilation: any = {
      errors: [],
      hooks: {processAssets: {tap: (_: any, fn: any) => fn({})}}
    }
    ;(compiler as any).hooks = {
      thisCompilation: {tap: (_: any, fn: any) => fn(compilation)}
    }
    step.apply(compiler)
    expect(compilation.errors.length).toBeGreaterThan(0)
  })
})
