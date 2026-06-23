import {describe, expect, it} from 'vitest'
import {background} from '../background'

describe('mv2 background override', () => {
  it('dedupes a multi-file background.scripts array to the single emitted bundle', () => {
    const result = background({
      manifest_version: 2,
      background: {scripts: ['one.js', 'two.js', 'three.js']}
    } as any) as any

    // All source scripts bundle into one file, so the output references it once.
    expect(result.background.scripts).toEqual(['background/scripts.js'])
  })

  it('returns falsy when there is no background.scripts', () => {
    expect(background({manifest_version: 2} as any)).toBeFalsy()
  })
})
