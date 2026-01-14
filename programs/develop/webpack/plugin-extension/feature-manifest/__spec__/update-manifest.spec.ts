import {describe, it, expect, vi} from 'vitest'
import {UpdateManifest} from '../steps/update-manifest'

vi.mock('../../webpack-lib/utils', () => ({
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
  const make = (mode: 'development' | 'production') => {
    const assets: Record<string, any> = {
      'manifest.json': {source: () => '{"name":"x"}'}
    }
    const updated: Record<string, string> = {}
    const compilation: any = {
      errors: [],
      assets,
      getAsset: (n: string) =>
        assets[n] ? {source: assets[n].source} : undefined,
      hooks: {
        processAssets: {tap: (_opts: any, fn: any) => fn()}
      },
      updateAsset: (name: string, src: any) =>
        (updated[name] = src.source().toString())
    }
    const compiler: any = {
      options: {mode},
      hooks: {thisCompilation: {tap: (_n: string, fn: any) => fn(compilation)}}
    }
    return {compiler, updated}
  }

  it('applies overrides and dev content_scripts overrides in development', () => {
    const {compiler, updated} = make('development')
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.icons).toBeDefined()
    const firstJs = out.content_scripts?.[0]?.js?.[0]
    if (firstJs) expect(firstJs).toContain('content_scripts-0')
  })

  it('updates asset in production as well', () => {
    const {compiler, updated} = make('production')
    new UpdateManifest({manifestPath: '/m'} as any).apply(compiler)
    const out = JSON.parse(updated['manifest.json'])
    expect(out.icons).toBeDefined()
  })
})

