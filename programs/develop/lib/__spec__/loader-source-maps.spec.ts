import {describe, expect, it} from 'vitest'
import {
  adjustLoaderSourceMap,
  identityLineMap,
  inputOrIdentityMap
} from '../loader-source-maps'

describe('loader source maps', () => {
  it('builds an identity line map that carries the original text', () => {
    const map = identityLineMap('/p/a.ts', 'one\ntwo\nthree')
    expect(map.sources).toEqual(['/p/a.ts'])
    expect(map.sourcesContent).toEqual(['one\ntwo\nthree'])
    expect(map.mappings).toBe('AAAA;AACA;AACA')
  })

  it('keeps a map it received and falls back to the identity', () => {
    const received = {
      version: 3,
      file: '',
      sources: ['x'],
      names: [],
      mappings: 'AAAA'
    }
    expect(inputOrIdentityMap(received, '/p/a.ts', 'a')).toEqual(received)
    expect(
      inputOrIdentityMap(JSON.stringify(received), '/p/a.ts', 'a')
    ).toEqual(received)
    expect(inputOrIdentityMap(undefined, '/p/a.ts', 'a\nb').mappings).toBe(
      'AAAA;AACA'
    )
  })

  it('pads for a prefix and drops the groups of deleted lines', () => {
    const before = 'l0\nl1\nmain()\nl3'
    const after = 'l0\nl1\nl3'
    const map = identityLineMap('/p/a.ts', before)
    const adjusted = adjustLoaderSourceMap(map, {
      prefix: 'p1\np2\n',
      before,
      after
    })
    // two empty groups for the prefix, then l0, l1, l3 (the main() group is gone)
    expect(adjusted.mappings).toBe(';;AAAA;AACA;AACA')
    expect(adjusted.mappings.split(';')).toHaveLength(2 + 3)
  })
})
