import {describe, expect, it} from 'vitest'
import {
  classifyManagedInstallTarget,
  firstNonManagedInstallTarget,
  installTargets,
  MANAGED_INSTALL_BINARIES,
  MANAGED_INSTALL_TARGETS,
  validateManagedInstallTargets,
  vendors
} from '../vendors'

describe('vendors', () => {
  it('defaults to chromium', () => {
    expect(vendors(undefined)).toEqual(['chromium'])
  })

  it("expands 'all' to one browser per engine family for run/build", () => {
    expect(vendors('all')).toEqual(['chrome', 'edge', 'firefox'])
  })

  it('splits comma-separated values and trims whitespace', () => {
    expect(vendors('chrome,firefox' as any)).toEqual(['chrome', 'firefox'])
    expect(vendors('chrome, edge' as any)).toEqual(['chrome', 'edge'])
  })
})

describe('installTargets', () => {
  it("includes chromium in 'all' so the dev/start default browser is covered", () => {
    expect(installTargets('all')).toEqual([...MANAGED_INSTALL_BINARIES])
  })

  it('passes single browsers and the default through to vendors()', () => {
    expect(installTargets('firefox')).toEqual(['firefox'])
    expect(installTargets(undefined)).toEqual(['chromium'])
  })

  it('splits comma lists the same way install and uninstall will see them', () => {
    expect(installTargets('chrome,edge' as any)).toEqual(['chrome', 'edge'])
  })
})

describe('validateManagedInstallTargets', () => {
  it('accepts every managed name and family alias', () => {
    expect(
      validateManagedInstallTargets([...MANAGED_INSTALL_TARGETS], () => {
        throw new Error('should not reject managed names')
      })
    ).toBe(true)
  })

  it('rejects forks and unknown names with the managed list', () => {
    let invalid = ''
    let supported: string[] = []
    expect(
      validateManagedInstallTargets(['brave'], (name, list) => {
        invalid = name
        supported = list
      })
    ).toBe(false)
    expect(invalid).toBe('brave')
    expect(supported).toEqual([...MANAGED_INSTALL_TARGETS])
  })
})

describe('classifyManagedInstallTarget', () => {
  it('marks managed binaries and family aliases as managed', () => {
    for (const name of MANAGED_INSTALL_TARGETS) {
      expect(classifyManagedInstallTarget(name)).toBe('managed')
    }
  })

  it('marks known system-located vendors as not-installable', () => {
    for (const name of [
      'brave',
      'opera',
      'vivaldi',
      'yandex',
      'waterfox',
      'librewolf',
      'safari',
      'webkit-based'
    ]) {
      expect(classifyManagedInstallTarget(name)).toBe('not-installable')
    }
  })

  it('marks typos and unknown names as unknown', () => {
    expect(classifyManagedInstallTarget('netscape')).toBe('unknown')
    expect(classifyManagedInstallTarget('brvae')).toBe('unknown')
  })

  it('returns the first non-managed name in a comma list', () => {
    expect(firstNonManagedInstallTarget(['chrome', 'brave', 'edge'])).toEqual({
      name: 'brave',
      kind: 'not-installable'
    })
    expect(firstNonManagedInstallTarget(['chrome', 'netscape'])).toEqual({
      name: 'netscape',
      kind: 'unknown'
    })
    expect(firstNonManagedInstallTarget(['chrome', 'edge'])).toBeNull()
  })
})
