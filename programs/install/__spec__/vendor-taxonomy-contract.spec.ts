import {describe, expect, it} from 'vitest'
import {
  MANAGED_INSTALL_BINARIES,
  MANAGED_INSTALL_TARGETS
} from '../../extension/helpers/vendors'
import {BROWSER_ALIASES} from '../lib/browser-target'

// MANAGED_INSTALL_TARGETS (the CLI's accepted install names) and
// BROWSER_ALIASES (this package's resolver) are maintained by hand in two
// packages. A name present in one but not the other reproduces the split
// this contract exists to prevent: the CLI accepts a vendor the installer
// throws on, or the installer resolves a name the CLI never offers.
describe('install vendor taxonomy contract', () => {
  it('accepts exactly the same names in both packages', () => {
    expect(Object.keys(BROWSER_ALIASES).sort()).toEqual(
      [...MANAGED_INSTALL_TARGETS].sort()
    )
  })

  it('resolves every accepted name onto a managed binary', () => {
    for (const target of MANAGED_INSTALL_TARGETS) {
      expect(MANAGED_INSTALL_BINARIES).toContain(BROWSER_ALIASES[target])
    }
  })
})
