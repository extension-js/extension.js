import {describe, it, expect} from 'vitest'
import {parseExtensionsList} from '../utils/normalize-options'

describe('parseExtensionsList', () => {
  it('returns undefined for empty input', () => {
    expect(parseExtensionsList(undefined)).toBeUndefined()
    expect(parseExtensionsList('')).toBeUndefined()
    expect(parseExtensionsList('   ')).toBeUndefined()
  })

  it('splits comma-separated values and trims whitespace', () => {
    expect(parseExtensionsList(' a, b ,c ')).toEqual(['a', 'b', 'c'])
  })
})
