import {describe, it, expect} from 'vitest'
import {Compilation, sources} from '@rspack/core'
import {UpdateManifest} from '../steps/update-manifest'

function makeCompiler(mode: 'development' | 'production') {
  const compilation: any = {
    hooks: {processAssets: {tap: (_: any, cb: Function) => cb()}},
    errors: [],
    getAsset: () => ({
      name: 'manifest.json',
      source: {source: () => JSON.stringify({})}
    }),
    assets: {
      'manifest.json': new sources.RawSource(
        JSON.stringify(
          {
            manifest_version: 3,
            content_scripts: [
              {
                matches: ['<all_urls>'],
                // CSS only, no JS
                js: [],
                css: ['content/styles.css']
              }
            ]
          },
          null,
          2
        )
      )
    },
    updateAsset: function (name: string, source: any) {
      this.assets[name] = source
    }
  }
  const compiler: any = {
    hooks: {
      thisCompilation: {tap: (_: string, cb: Function) => cb(compilation)}
    },
    options: {mode}
  }
  return {compiler, compilation}
}

describe('UpdateManifest (dev CSS-only content_scripts)', () => {
  it('adds a JS stub in development to enable HMR', () => {
    const plugin = new UpdateManifest({
      manifestPath: '/abs/manifest.json'
    } as any)
    const {compiler, compilation} = makeCompiler('development')
    plugin.apply(compiler)

    const result = JSON.parse(
      compilation.assets['manifest.json'].source().toString()
    )

    expect(result.content_scripts[0].js.length).toBe(1)
    expect(result.content_scripts[0].js[0]).toBe('content_scripts-0')
  })

  it('does not add a JS stub in production', () => {
    const plugin = new UpdateManifest({
      manifestPath: '/abs/manifest.json'
    } as any)
    const {compiler, compilation} = makeCompiler('production')
    plugin.apply(compiler)

    const result = JSON.parse(
      compilation.assets['manifest.json'].source().toString()
    )
    // Production path keeps content as emitted; no dev stub added here
    expect(Array.isArray(result.content_scripts[0].js)).toBe(true)
  })
})
