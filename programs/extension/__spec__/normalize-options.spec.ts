import {describe, it, expect} from 'vitest'
import {
  parseExtensionsList,
  parsePositiveInt
} from '../helpers/normalize-options'

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

describe('parsePositiveInt', () => {
  it('treats an absent or blank value as unset', () => {
    expect(parsePositiveInt('--tab', undefined)).toEqual({
      ok: true,
      value: undefined
    })

    expect(parsePositiveInt('--tab', '  ')).toEqual({ok: true, value: undefined})
  })

  it('accepts a whole positive number', () => {
    expect(parsePositiveInt('--timeout', ' 250 ')).toEqual({
      ok: true,
      value: 250
    })

    expect(parsePositiveInt('--tab', 7)).toEqual({ok: true, value: 7})
  })

  it('refuses text, negatives, zero and fractions by flag name', () => {
    for (const raw of ['abc', '-5', '0', '1.5', '1e3', 'Infinity']) {
      expect(parsePositiveInt('--max-bytes', raw)).toEqual({
        ok: false,
        message: `--max-bytes expects a positive integer, got: ${raw}`
      })
    }
  })
})
