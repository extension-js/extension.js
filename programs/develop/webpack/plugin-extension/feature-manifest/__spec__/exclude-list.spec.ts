import {describe, it, expect} from 'vitest'
import {sources} from '@rspack/core'
import {UpdateManifest} from '../steps/update-manifest'

describe('excludeList passthrough', () => {
  it('preserves entries that should be excluded from rewriting', () => {
    const plugin = new UpdateManifest({
      manifestPath: '/abs/manifest.json',
      excludeList: {}
    } as any)

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
              icons: {'16': 'icons/icon16.png'}
            },
            null,
            2
          )
        )
      },
      updateAsset(name: string, source: any) {
        this.assets[name] = source
      }
    }

    const compiler: any = {
      hooks: {
        thisCompilation: {tap: (_: string, cb: Function) => cb(compilation)}
      },
      options: {mode: 'production'}
    }

    plugin.apply(compiler)

    const manifest = JSON.parse(
      compilation.assets['manifest.json'].source().toString()
    )

    expect(manifest.icons['16']).toBe('icons/icon16.png')
  })
})
