import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as fs from 'fs'

vi.mock('fs', () => ({
  existsSync: vi.fn((p: string) => p.startsWith('/proj/')),
  readFileSync: vi.fn(() => JSON.stringify({}))
}))

import {AddScripts} from '../steps/add-scripts'

describe('AddScripts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores remote URLs and includes only existing local script/css files', () => {
    const plugin = new AddScripts({
      manifestPath: '/proj/manifest.json',
      includeList: {
        'background/scripts': [
          'https://cdn.example.com/x.js',
          '//cdn.example.com/y.js',
          '/proj/bg.js',
          '/proj/bg.css'
        ]
      }
    } as any)

    const compiler: any = {options: {entry: {}}}

    plugin.apply(compiler)

    const e = compiler.options.entry
    expect(e['background/scripts'].import).toContain('/proj/bg.js')
    expect(e['background/scripts'].import).toContain('/proj/bg.css')
    expect(
      e['background/scripts'].import.some((x: string) =>
        /cdn\.example\.com/.test(x)
      )
    ).toBe(false)
  })

  it('applies import-scripts chunkLoading only for classic service workers', () => {
    const manifest = {
      background: {type: 'module'}
    }
    ;(fs.readFileSync as any).mockReturnValueOnce(JSON.stringify(manifest))

    const pluginModule = new AddScripts({
      manifestPath: '/proj/manifest.json',
      includeList: {
        'background/service_worker': ['/proj/sw.js']
      }
    } as any)

    const compilerModule: any = {options: {entry: {}}}
    pluginModule.apply(compilerModule)
    expect(
      compilerModule.options.entry['background/service_worker'].chunkLoading
    ).toBeUndefined()

    const manifestClassic = {
      background: {type: 'classic'}
    }
    ;(fs.readFileSync as any).mockReturnValueOnce(
      JSON.stringify(manifestClassic)
    )

    const pluginClassic = new AddScripts({
      manifestPath: '/proj/manifest.json',
      includeList: {
        'background/service_worker': ['/proj/sw.js']
      }
    } as any)
    const compilerClassic: any = {options: {entry: {}}}
    pluginClassic.apply(compilerClassic)
    expect(
      compilerClassic.options.entry['background/service_worker'].chunkLoading
    ).toBe('import-scripts')
  })
})
