import {describe, expect, it} from 'vitest'
import {parseJsonSafe, stripBom} from '../parse-json-safe'

describe('stripBom', () => {
  it('removes a leading UTF-8 BOM', () => {
    expect(stripBom('\uFEFF{"a":1}')).toBe('{"a":1}')
  })

  it('leaves BOM-less input untouched', () => {
    expect(stripBom('{"a":1}')).toBe('{"a":1}')
  })

  it('only strips the first BOM (not interior characters)', () => {
    expect(stripBom('\uFEFF{"a":"\uFEFF"}')).toBe('{"a":"\uFEFF"}')
  })

  it('handles Buffers and empty input', () => {
    expect(stripBom(Buffer.from('\uFEFF[]', 'utf8'))).toBe('[]')
    expect(stripBom('')).toBe('')
  })
})

describe('parseJsonSafe', () => {
  it('parses BOM-prefixed JSON (Chrome tolerates the BOM, G22)', () => {
    expect(parseJsonSafe('\uFEFF{"manifest_version":3}')).toEqual({
      manifest_version: 3
    })
  })

  it('parses empty input as {}', () => {
    expect(parseJsonSafe('')).toEqual({})
  })

  it('still throws on invalid JSON', () => {
    expect(() => parseJsonSafe('{nope')).toThrow()
  })
})
