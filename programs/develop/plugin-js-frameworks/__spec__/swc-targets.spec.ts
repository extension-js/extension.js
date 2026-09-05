import {describe, expect, it} from 'vitest'
import {DEFAULT_SWC_TARGETS, resolveSwcTargets} from '../swc-targets'

const GECKO = {gecko: {id: 'probe@ext', strict_min_version: '42.0'}}

describe('resolveSwcTargets', () => {
  it('keeps a chrome build modern when only a firefox floor is declared', () => {
    expect(
      resolveSwcTargets({browser_specific_settings: GECKO} as any, 'chrome')
    ).toEqual(DEFAULT_SWC_TARGETS)
  })

  it('honors the vendor-prefixed gecko floor on a firefox build', () => {
    expect(
      resolveSwcTargets(
        {'firefox:browser_specific_settings': GECKO} as any,
        'firefox'
      )
    ).toEqual(['firefox >= 42'])
  })

  it('reads the plain and the prefixed gecko spelling the same way', () => {
    const plain = resolveSwcTargets(
      {browser_specific_settings: GECKO} as any,
      'firefox'
    )
    const prefixed = resolveSwcTargets(
      {'gecko:browser_specific_settings': GECKO} as any,
      'firefox'
    )
    expect(plain).toEqual(prefixed)
  })

  it('keeps the chrome minimum downleveling the chrome bundle', () => {
    expect(
      resolveSwcTargets({minimum_chrome_version: '30'} as any, 'chrome')
    ).toEqual(['chrome >= 30'])
    expect(
      resolveSwcTargets({minimum_chrome_version: '30'} as any, 'edge')
    ).toEqual(['chrome >= 30'])
  })

  it('keeps the legacy applications.gecko spelling', () => {
    expect(resolveSwcTargets({applications: GECKO} as any, 'firefox')).toEqual([
      'firefox >= 42'
    ])
  })

  it('ignores a chrome floor on a firefox build and a bad floor value', () => {
    expect(
      resolveSwcTargets({minimum_chrome_version: '30'} as any, 'firefox')
    ).toEqual(DEFAULT_SWC_TARGETS)
    expect(
      resolveSwcTargets(
        {browser_specific_settings: {gecko: {strict_min_version: 'x'}}} as any,
        'firefox'
      )
    ).toEqual(DEFAULT_SWC_TARGETS)
    expect(resolveSwcTargets(undefined, 'chrome')).toEqual(DEFAULT_SWC_TARGETS)
  })
})
