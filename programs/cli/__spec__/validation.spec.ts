import {describe, it, expect} from 'vitest'
import {isValidHttpUrl} from '../cli-lib/validation'

describe('isValidHttpUrl', () => {
  it('accepts valid http/https URLs', () => {
    expect(isValidHttpUrl('http://example.com')).toBe(true)
    expect(isValidHttpUrl('https://example.com')).toBe(true)
    expect(isValidHttpUrl('https://example.com/path?x=1#hash')).toBe(true)
  })

  it('rejects invalid or non-http(s) URLs', () => {
    expect(isValidHttpUrl('ftp://example.com')).toBe(false)
    expect(isValidHttpUrl('not-a-url')).toBe(false)
    expect(isValidHttpUrl(undefined)).toBe(false)
  })
})
