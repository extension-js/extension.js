import {describe, it, expect, vi, beforeEach} from 'vitest'
import * as fs from 'fs'

vi.mock('fs', () => ({
  existsSync: vi.fn((p: string) => p.startsWith('/proj/')),
  readFileSync: vi.fn(() => JSON.stringify({}))
}))

import {AddScripts} from '../steps/add-scripts'
import {AddContentScriptWrapper} from '../steps/setup-reload-strategy/add-content-script-wrapper'
import * as path from 'path'

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

  it('includes public-root entries in the bundle imports', () => {
    const publicJs = '/proj/public/foo.js'
    const publicCss = '/proj/public/style.css'

    const compiler: any = {
      options: {
        context: '/proj',
        entry: {},
        output: {path: '/out'}
      }
    }

    const plugin = new AddScripts({
      manifestPath: '/proj/manifest.json',
      includeList: {
        'background/scripts': [publicJs, publicCss]
      }
    } as any)

    plugin.apply(compiler)

    const entry = compiler.options.entry['background/scripts']
    expect(entry.import).toContain(publicJs)
    expect(entry.import).toContain(publicCss)
  })

  it('includes bridge entries resolved from compiled .cjs artifacts', () => {
    vi.spyOn(AddContentScriptWrapper, 'getBridgeScripts').mockReturnValue({
      'content_scripts/content-5': '/proj/dist/main-world-bridge.cjs'
    } as any)

    const compiler: any = {
      options: {
        context: '/proj',
        entry: {}
      }
    }

    const plugin = new AddScripts({
      manifestPath: '/proj/manifest.json',
      includeList: {}
    } as any)

    plugin.apply(compiler)

    expect(compiler.options.entry['content_scripts/content-5']).toEqual({
      import: ['/proj/dist/main-world-bridge.cjs']
    })
  })

  it('includes all supported script extensions in bundle imports', () => {
    const compiler: any = {
      options: {
        context: '/proj',
        entry: {}
      }
    }

    const plugin = new AddScripts({
      manifestPath: '/proj/manifest.json',
      includeList: {
        'background/scripts': [
          '/proj/bg.cjs',
          '/proj/bg.mjs',
          '/proj/bg.jsx',
          '/proj/bg.mjsx',
          '/proj/bg.ts',
          '/proj/bg.mts',
          '/proj/bg.tsx',
          '/proj/bg.mtsx'
        ]
      }
    } as any)

    plugin.apply(compiler)

    expect(compiler.options.entry['background/scripts'].import).toEqual([
      '/proj/bg.cjs',
      '/proj/bg.mjs',
      '/proj/bg.jsx',
      '/proj/bg.mjsx',
      '/proj/bg.ts',
      '/proj/bg.mts',
      '/proj/bg.tsx',
      '/proj/bg.mtsx'
    ])
  })
})
