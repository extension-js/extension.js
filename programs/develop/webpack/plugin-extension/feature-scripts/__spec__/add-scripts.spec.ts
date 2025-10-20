import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {describe, expect, it, beforeEach, afterEach} from 'vitest'
import {AddScripts} from '../steps/add-scripts'

function createCompiler(mode: 'development' | 'production' = 'development') {
  return {
    options: {entry: {}, mode}
  } as any
}

describe('AddScripts', () => {
  let tmp: string
  let manifestPath: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-'))
    manifestPath = path.join(tmp, 'manifest.json')
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3, background: {type: 'classic'}})
    )
  })

  afterEach(() => {
    try {
      fs.rmSync(tmp, {recursive: true, force: true})
    } catch {}
  })

  it('adds entries for provided includeList combining js and css', () => {
    const compiler = createCompiler()
    const js = path.join(tmp, 'a.js')
    const css = path.join(tmp, 'a.css')
    fs.writeFileSync(js, '')
    fs.writeFileSync(css, '')
    const plugin = new AddScripts({
      manifestPath,
      includeList: {
        'content_scripts/content-0': [js, css]
      },
      excludeList: {}
    } as any)

    plugin.apply(compiler)

    expect(compiler.options.entry).toEqual({
      'content_scripts/content-0': {import: [js, css]}
    })
  })

  it('sets chunkLoading import-scripts only for non-module service_worker', () => {
    const compiler = createCompiler()
    const sw = path.join(tmp, 'sw.ts')
    fs.writeFileSync(sw, '')
    const plugin = new AddScripts({
      manifestPath,
      includeList: {
        'background/service_worker': [sw]
      },
      excludeList: {}
    } as any)
    plugin.apply(compiler)

    expect(compiler.options.entry['background/service_worker']).toEqual({
      import: [sw],
      chunkLoading: 'import-scripts'
    })

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({manifest_version: 3, background: {type: 'module'}})
    )

    const compiler2 = createCompiler()
    const plugin2 = new AddScripts({
      manifestPath,
      includeList: {
        'background/service_worker': [sw]
      },
      excludeList: {}
    } as any)
    plugin2.apply(compiler2)

    expect(compiler2.options.entry['background/service_worker']).toEqual({
      import: [sw]
    })
  })
})
