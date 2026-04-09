import {describe, it, expect} from 'vitest'
import {
  normalizeSourceFormatOption,
  normalizeSourceIncludeShadowOption,
  normalizeSourceMaxBytesOption,
  normalizeSourceRedactOption,
  normalizeSourceDiffOption,
  normalizeSourceMetaOption,
  normalizeSourceProbeOption,
  normalizeSourceTreeOption,
  normalizeSourceConsoleOption,
  normalizeSourceDomOption,
  parseExtensionsList
} from '../utils/normalize-options'

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

describe('normalizeSourceFormatOption', () => {
  it('uses source format when provided', () => {
    expect(
      normalizeSourceFormatOption({
        sourceFormat: 'ndjson',
        logFormat: 'pretty',
        sourceEnabled: true
      })
    ).toBe('ndjson')
  })

  it('falls back to log format when source format missing', () => {
    expect(
      normalizeSourceFormatOption({
        logFormat: 'json',
        sourceEnabled: true
      })
    ).toBe('json')
  })

  it('defaults to json when source enabled and no format set', () => {
    expect(
      normalizeSourceFormatOption({
        sourceEnabled: true
      })
    ).toBe('json')
  })
})

describe('normalizeSourceRedactOption', () => {
  it('defaults to safe for machine formats', () => {
    expect(normalizeSourceRedactOption(undefined, 'json')).toBe('safe')
  })

  it('defaults to off for pretty', () => {
    expect(normalizeSourceRedactOption(undefined, 'pretty')).toBe('off')
  })
})

describe('normalizeSourceMaxBytesOption', () => {
  it('parses numeric values', () => {
    expect(normalizeSourceMaxBytesOption('256')).toBe(256)
    expect(normalizeSourceMaxBytesOption(0)).toBe(0)
  })

  it('returns undefined for invalid values', () => {
    expect(normalizeSourceMaxBytesOption('nope')).toBeUndefined()
    expect(normalizeSourceMaxBytesOption(-1)).toBeUndefined()
  })
})

describe('normalizeSourceIncludeShadowOption', () => {
  it('defaults to open-only when source enabled', () => {
    expect(normalizeSourceIncludeShadowOption(undefined, true)).toBe(
      'open-only'
    )
  })

  it('returns undefined when source disabled', () => {
    expect(normalizeSourceIncludeShadowOption(undefined, false)).toBeUndefined()
  })
})

describe('normalizeSourceDiffOption', () => {
  it('defaults to true when watch is enabled', () => {
    expect(normalizeSourceDiffOption(undefined, true)).toBe(true)
  })

  it('returns undefined when watch disabled and no input', () => {
    expect(normalizeSourceDiffOption(undefined, false)).toBeUndefined()
  })
})

describe('normalizeSourceMetaOption', () => {
  it('defaults to true when source enabled', () => {
    expect(normalizeSourceMetaOption(undefined, true)).toBe(true)
  })
})

describe('normalizeSourceProbeOption', () => {
  it('splits selectors by comma', () => {
    expect(normalizeSourceProbeOption('#a, .b')).toEqual(['#a', '.b'])
  })
})

describe('normalizeSourceTreeOption', () => {
  it('returns undefined for missing input', () => {
    expect(normalizeSourceTreeOption(undefined, true)).toBeUndefined()
  })
})

describe('normalizeSourceConsoleOption', () => {
  it('returns undefined by default', () => {
    expect(normalizeSourceConsoleOption(undefined, true)).toBeUndefined()
  })
})

describe('normalizeSourceDomOption', () => {
  it('defaults to true when watch is enabled', () => {
    expect(normalizeSourceDomOption(undefined, true)).toBe(true)
  })
})
