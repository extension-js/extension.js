import {sources} from '@rspack/core'
import {describe, expect, it} from 'vitest'
import {prependToEmittedAsset} from '../asset-source-maps'

function fakeCompilation(assets: Record<string, string>) {
  const store = new Map(
    Object.entries(assets).map(([name, text]) => [
      name,
      new sources.RawSource(text)
    ])
  )
  return {
    getAsset: (name: string) =>
      store.has(name) ? {name, source: store.get(name)} : undefined,
    updateAsset: (name: string, source: sources.RawSource) => {
      store.set(name, source)
    },
    text: (name: string) => store.get(name)?.source().toString()
  }
}

describe('prependToEmittedAsset', () => {
  it('prepends the text and pads the emitted map by the same lines', () => {
    const compilation = fakeCompilation({
      'background/service_worker.js': 'a\nb\n',
      'background/service_worker.js.map': JSON.stringify({
        version: 3,
        sources: ['x'],
        mappings: 'AAAA;AACA'
      })
    })
    prependToEmittedAsset(
      compilation as any,
      compilation.getAsset('background/service_worker.js') as any,
      'r1\nr2\n'
    )
    expect(compilation.text('background/service_worker.js')).toBe(
      'r1\nr2\na\nb\n'
    )
    const map = JSON.parse(
      compilation.text('background/service_worker.js.map') as string
    )
    expect(map.mappings).toBe(';;AAAA;AACA')
  })

  it('leaves an asset without a map untouched apart from the prefix', () => {
    const compilation = fakeCompilation({'content.js': 'x'})
    prependToEmittedAsset(
      compilation as any,
      compilation.getAsset('content.js') as any,
      'p\n'
    )
    expect(compilation.text('content.js')).toBe('p\nx')
    expect(compilation.getAsset('content.js.map')).toBeUndefined()
  })
})
