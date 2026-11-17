import {describe, expect, it} from 'vitest'
import {GECKO_BASED_BROWSERS} from '../../../../develop/lib/constants'
import {
  CHROMIUM_BROWSERS,
  FIREFOX_BROWSERS,
  isChromiumBrowser,
  isSystemLocatedChromiumFork,
  SYSTEM_LOCATED_CHROMIUM_FORKS
} from '../../browsers-lib/browser-family'

describe('system-located chromium forks', () => {
  it('names every fork the launcher locates instead of downloading', () => {
    expect([...SYSTEM_LOCATED_CHROMIUM_FORKS].sort()).toEqual([
      'brave',
      'opera',
      'vivaldi',
      'yandex'
    ])
  })

  it('excludes the browsers the managed cache really holds', () => {
    for (const managed of ['chrome', 'chromium', 'chromium-based', 'edge']) {
      expect(isSystemLocatedChromiumFork(managed)).toBe(false)
    }
  })

  it('keeps every fork inside the chromium family', () => {
    for (const fork of SYSTEM_LOCATED_CHROMIUM_FORKS) {
      expect(isChromiumBrowser(fork)).toBe(true)
      expect(CHROMIUM_BROWSERS.has(fork)).toBe(true)
    }
  })

  it('says no for gecko targets and unknown names', () => {
    for (const other of ['firefox', 'zen', 'floorp', 'safari', '', 'nope']) {
      expect(isSystemLocatedChromiumFork(other)).toBe(false)
    }
  })
})

describe('gecko family', () => {
  it('covers every named fork the gecko family knows', () => {
    const aliases = ['gecko-based', 'firefox-based']
    const named = [...FIREFOX_BROWSERS].filter((b) => !aliases.includes(b))

    expect(named.sort()).toEqual([...GECKO_BASED_BROWSERS].sort())
    expect(named.filter((b) => b !== 'firefox')).toEqual([
      'floorp',
      'librewolf',
      'waterfox',
      'zen'
    ])
  })
})
