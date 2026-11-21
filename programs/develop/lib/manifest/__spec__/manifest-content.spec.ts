import type {Compilation} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import * as store from '../manifest-content'

// A compilation as rspack hands it over: the assets can be read back.
function compilationWith(text: string): Compilation {
  const assets = new Map([['manifest.json', text]])
  const compilation: Pick<Compilation, 'getAsset'> = {
    getAsset: (name: string) =>
      assets.has(name)
        ? ({source: {source: () => assets.get(name)}} as ReturnType<
            Compilation['getAsset']
          >)
        : undefined
  }

  return compilation as Compilation
}

describe('the manifest text of a compilation', () => {
  it('is the asset, with the authored text kept beside it', () => {
    const compilation = compilationWith('{"name":"emitted"}')

    store.setOriginalManifestContent(compilation, '{"name":"authored"}')

    expect(store.readManifestAssetText(compilation)).toBe('{"name":"emitted"}')
    expect(store.getManifestContent(compilation, 'unread')).toEqual({
      name: 'emitted'
    })

    expect(store.getOriginalManifest(compilation)).toEqual({name: 'authored'})
  })

  // A second copy of the emitted text could disagree with the asset.
  it('has no second copy of the emitted text for a step to write', () => {
    expect(
      Object.keys(store).filter((name) => /CurrentManifest/.test(name))
    ).toEqual([])
  })
})
