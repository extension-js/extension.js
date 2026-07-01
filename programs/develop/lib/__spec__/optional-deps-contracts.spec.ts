import {describe, it, expect} from 'vitest'
import {
  OPTIONAL_DEPENDENCY_CONTRACTS,
  getOptionalDependencyContract
} from '../optional-deps-contracts'
import developPackageJson from '../../package.json'

const bundled = (developPackageJson as {dependencies?: Record<string, string>})
  .dependencies as Record<string, string>

// The install hints each contract prints must stay pinned to the exact version
// extension-develop bundles — that is the whole point of single-sourcing them
// from package.json. A regression here means the hints have drifted from what
// actually ships (the bug that produced `less-loader@12` hints while shipping
// `less-loader@13`).
describe('optional dependency contracts', () => {
  it('derives every install spec from the bundled develop dependency version', () => {
    for (const contract of Object.values(OPTIONAL_DEPENDENCY_CONTRACTS)) {
      for (const spec of contract.installPackages) {
        const at = spec.lastIndexOf('@')
        // Package name is everything before the last `@` (handles scoped names
        // like `@vue/compiler-sfc@3.5.26`); a leading `@` is the scope, not a
        // version separator.
        const name = at > 0 ? spec.slice(0, at) : spec
        const version = at > 0 ? spec.slice(at + 1) : undefined

        expect(
          bundled[name],
          `${name} is referenced by contract "${contract.id}" but is not bundled in extension-develop`
        ).toBeTruthy()
        expect(
          version,
          `${name} spec "${spec}" should carry the bundled version`
        ).toBe(bundled[name])
      }
    }
  })

  it('only references packages extension-develop actually bundles', () => {
    const referenced = new Set(
      Object.values(OPTIONAL_DEPENDENCY_CONTRACTS)
        .flatMap((c) => c.installPackages)
        .map((spec) => {
          const at = spec.lastIndexOf('@')
          return at > 0 ? spec.slice(0, at) : spec
        })
    )
    for (const name of referenced) {
      expect(bundled[name], `${name} must be a bundled dependency`).toBeTruthy()
    }
  })

  it('throws for an unknown contract id', () => {
    expect(() => getOptionalDependencyContract('does-not-exist')).toThrow()
  })
})
