import {describe, expect, it} from 'vitest'
import {installTargets, vendors} from '../vendors'

describe('vendors', () => {
  it('defaults to chromium', () => {
    expect(vendors(undefined)).toEqual(['chromium'])
  })

  it("expands 'all' to one browser per engine family for run/build", () => {
    expect(vendors('all')).toEqual(['chrome', 'edge', 'firefox'])
  })

  it('splits comma-separated values', () => {
    expect(vendors('chrome,firefox' as any)).toEqual(['chrome', 'firefox'])
  })
})

describe('installTargets', () => {
  it("includes chromium in 'all' so the dev/start default browser is covered", () => {
    expect(installTargets('all')).toEqual([
      'chrome',
      'chromium',
      'edge',
      'firefox'
    ])
  })

  it('passes single browsers and the default through to vendors()', () => {
    expect(installTargets('firefox')).toEqual(['firefox'])
    expect(installTargets(undefined)).toEqual(['chromium'])
  })
})
