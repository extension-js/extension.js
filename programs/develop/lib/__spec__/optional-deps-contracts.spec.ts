import {describe, expect, it} from 'vitest'
import developPackageJson from '../../package.json'
import {
  getOptionalDependencyContract,
  OPTIONAL_DEPENDENCY_CONTRACTS
} from '../optional-deps-contracts'

const bundled = (developPackageJson as {dependencies?: Record<string, string>})
  .dependencies as Record<string, string>

// The install hints each contract prints must stay pinned to the exact version
// extension-develop bundles. That is the whole point of single-sourcing them
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

// extension-develop used to ship a 24MB `typescript` dependency for one file
// (the classic-concat loader, which called ts.transpileModule and
// ts.createSourceFile). That loader now uses the swc rspack already bundles
// plus acorn, so the dependency is gone. These guard the invariants that make
// the removal safe, because re-adding a typescript contract would hard-fail every
// project that uses TypeScript without declaring it.
describe('typescript is not a build-time requirement', () => {
  it('exposes no typescript contract', () => {
    expect(Object.keys(OPTIONAL_DEPENDENCY_CONTRACTS)).not.toContain(
      'typescript'
    )
    expect(() => getOptionalDependencyContract('typescript')).toThrow()
  })

  it('has no contract that installs or verifies typescript', () => {
    for (const contract of Object.values(OPTIONAL_DEPENDENCY_CONTRACTS)) {
      expect(
        contract.installPackages.some((spec) => spec.startsWith('typescript@')),
        `contract "${contract.id}" must not suggest installing typescript`
      ).toBe(false)
      for (const rule of contract.verificationRules) {
        expect(
          (rule as {packageId?: string}).packageId,
          `contract "${contract.id}" must not verify typescript`
        ).not.toBe('typescript')
      }
    }
  })

  it('does not SHIP typescript to consumers', () => {
    // devDependencies are fine and expected, since rslib needs the compiler to
    // generate this package's own .d.ts files. What must never come back is
    // the `dependencies` entry, which is what every consumer downloads
    // (~23.6MB unpacked) and what the removed contract depended on.
    const pkg = developPackageJson as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.typescript).toBeUndefined()
  })

  it('never declares a package in both dependency blocks', () => {
    // pnpm resolves the `dependencies` entry and silently drops the other, so
    // a duplicate hides the real installed version. `typescript` was declared
    // twice (5.9.3 runtime / 6.0.2 dev) and shipped 5.9.3 while the manifest
    // read 6.0.2.
    const pkg = developPackageJson as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = Object.keys(pkg.dependencies || {})
    const devDeps = new Set(Object.keys(pkg.devDependencies || {}))
    const both = deps.filter((name) => devDeps.has(name))
    expect(both, `declared in both blocks: ${both.join(', ')}`).toEqual([])
  })

  it('declares acorn, the parser that replaced the TypeScript AST walk', () => {
    expect(bundled.acorn).toBeTruthy()
  })

  it('keeps the svelte contract free of typescript', () => {
    const svelte = getOptionalDependencyContract('svelte')
    expect(svelte.installPackages).toEqual([
      `svelte-loader@${bundled['svelte-loader']}`
    ])
  })
})
