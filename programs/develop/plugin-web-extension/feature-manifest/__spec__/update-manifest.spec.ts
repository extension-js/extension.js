import {describe, expect, it, vi} from 'vitest'
import {setOriginalManifestContent} from '../manifest-lib/manifest'
import {UpdateManifest} from '../steps/update-manifest'

vi.mock('../../lib/utils', () => ({
  getManifestContent: (_c: any, _p: string) => ({
    name: 'x',
    content_scripts: [{js: [], css: ['a.css']}]
  }),
  getFilename: (n: string) => `${n}`
}))

vi.mock('../manifest-overrides', () => ({
  getManifestOverrides: () => JSON.stringify({icons: {}})
}))

describe('UpdateManifest', () => {
  const make = (
    mode: 'development' | 'production',
    manifestSource = '{"name":"x"}',
    extraAssets: string[] = []
  ) => {
    const assets: Record<string, any> = {
      'manifest.json': {source: () => manifestSource}
    }
    for (const name of extraAssets) {
      assets[name] = {source: () => ''}
    }
    const updated: Record<string, string> = {}
    const compilation: any = {
      errors: [],
      warnings: [],
      options: {mode},
      assets,
      getAsset: (n: string) =>
        assets[n] ? {source: assets[n].source} : undefined,
      getAssets: () =>
        Object.entries(assets).map(([name, src]) => ({name, source: src})),
      hooks: {
        processAssets: {tap: (_opts: any, fn: any) => fn()}
      },
      updateAsset: (name: string, src: any) =>
        (updated[name] = src.source().toString())
    }
    const compiler: any = {
      options: {mode},
      hooks: {
        thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
      }
    }
    return {compiler, updated}
  }

  it('applies overrides and dev content_scripts overrides in development', () => {
    const {compiler, updated} = make(
      'development',
      JSON.stringify({
        name: 'x',
        content_scripts: [{matches: ['*://*/*'], css: ['a.css']}]
      })
    )
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.icons).toBeDefined()
    expect(out.content_scripts?.[0]?.js).toEqual([
      'content_scripts/content-0.js'
    ])
  })

  it('resolves the css-only dev stub to the hashed emitted asset', () => {
    const {compiler, updated} = make(
      'development',
      JSON.stringify({
        name: 'x',
        content_scripts: [{matches: ['*://*/*'], css: ['a.css']}]
      }),
      ['content_scripts/content-0.deadbeef.js']
    )
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.content_scripts?.[0]?.js).toEqual([
      'content_scripts/content-0.deadbeef.js'
    ])
  })

  it('derives the css-only stub index from the canonical css path, not array position', () => {
    const {compiler, updated} = make(
      'development',
      JSON.stringify({
        name: 'x',
        content_scripts: [
          {matches: ['*://*/*'], js: ['content_scripts/content-0.js']},
          {matches: ['*://*/*'], css: ['content_scripts/content-3.css']}
        ]
      })
    )
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.content_scripts?.[1]?.js).toEqual([
      'content_scripts/content-3.js'
    ])
  })

  it('updates asset in production as well', () => {
    const {compiler, updated} = make('production')
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.icons).toBeDefined()
  })

  it('emits manifest.json when no public asset exists yet', () => {
    const emitted: Record<string, string> = {}
    const compilation: any = {
      errors: [],
      warnings: [],
      assets: {},
      getAsset: () => undefined,
      hooks: {
        processAssets: {tap: (_opts: any, fn: any) => fn()}
      },
      updateAsset: vi.fn(),
      emitAsset: (name: string, src: any) => {
        emitted[name] = src.source().toString()
      }
    }
    const compiler: any = {
      options: {mode: 'production'},
      hooks: {
        thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}
      }
    }
    setOriginalManifestContent(
      compilation,
      JSON.stringify({name: 'x', content_scripts: [{js: [], css: ['a.css']}]})
    )

    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)

    expect(compilation.updateAsset).not.toHaveBeenCalled()
    expect(JSON.parse(emitted['manifest.json']).icons).toBeDefined()
  })
})
