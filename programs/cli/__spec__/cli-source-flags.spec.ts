import {describe, it, expect} from 'vitest'
import {assertValidSourceIfEnabled} from '../cli-lib/source-flags'

describe('cli source flags validation', () => {
  it('throws when --watch-source is provided without URL', () => {
    expect(() => assertValidSourceIfEnabled({watchSource: true})).toThrow()
  })

  it('throws when invalid URL provided via --source', () => {
    expect(() => assertValidSourceIfEnabled({source: 'ftp://x'})).toThrow()
  })

  it('accepts valid http(s) URL via --source', () => {
    expect(() =>
      assertValidSourceIfEnabled({source: 'https://example.com'})
    ).not.toThrow()
  })

  it('accepts valid http(s) URL via --starting-url and --watch-source', () => {
    expect(() =>
      assertValidSourceIfEnabled({
        watchSource: true,
        startingUrl: 'http://example.com'
      })
    ).not.toThrow()
  })
})

