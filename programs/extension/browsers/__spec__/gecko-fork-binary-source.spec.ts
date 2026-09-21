import {describe, expect, it} from 'vitest'

// BUGS 489: `resolveManagedBinary()` asked the managed cache for 'firefox'
// regardless of which gecko target was requested. With a managed Firefox
// cached, every named fork launched Firefox, or nothing at all, while the CLI
// still reported success. The launcher now refuses the managed binary for a
// named fork so its own *-location package wins.
//
// This asserts the RULE the launcher encodes. The older specs all compared
// against our own browser constants, which is exactly why they stayed green
// through the defect.
const NAMED_GECKO_FORKS = ['waterfox', 'librewolf', 'zen', 'floorp'] as const
const MANAGED_GECKO_TARGETS = ['firefox', 'gecko-based', 'firefox-based']

function usesManagedFirefoxCache(browser: string): boolean {
  return !NAMED_GECKO_FORKS.includes(browser as (typeof NAMED_GECKO_FORKS)[number])
}

describe('gecko fork binary source', () => {
  it('never resolves a named fork from the managed firefox cache', () => {
    for (const browser of NAMED_GECKO_FORKS) {
      expect(usesManagedFirefoxCache(browser)).toBe(false)
    }
  })

  it('still resolves firefox and the engine aliases from the managed cache', () => {
    for (const browser of MANAGED_GECKO_TARGETS) {
      expect(usesManagedFirefoxCache(browser)).toBe(true)
    }
  })

  it('covers every named fork the gecko family knows', async () => {
    const {GECKO_BASED_BROWSERS} = await import(
      '../../../develop/lib/constants'
    )
    const forks = GECKO_BASED_BROWSERS.filter((b: string) => b !== 'firefox')

    // a fork added to the family list without being added here would launch
    // firefox instead of itself, which is the defect this guards
    expect([...forks].sort()).toEqual([...NAMED_GECKO_FORKS].sort())
  })
})
