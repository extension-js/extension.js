import fc from 'fast-check'
import {describe, expect, it} from 'vitest'
import {dropMv2HostKeys, hostPermissions} from '../host_permissions'

const RUNS = {numRuns: 200}

const apiName = fc.constantFrom(
  'storage',
  'tabs',
  'alarms',
  'cookies',
  'scripting',
  'activeTab',
  'notifications'
)
const label = fc.stringMatching(/^[a-z]{1,6}$/)
const host = fc.oneof(
  fc.constant('<all_urls>'),
  fc
    .tuple(
      fc.constantFrom('https', 'http', '*'),
      label,
      fc.constantFrom('/*', '/api/*')
    )
    .map(([s, h, p]) => `${s}://${h}.example.com${p}`),
  label.map((h) => `*://*.${h}.org/*`)
)
// permissions may already hold a host pattern, the mv2 spelling Firefox reads.
const declared = fc.uniqueArray(fc.oneof(apiName, host), {maxLength: 6})
const hosts = fc.array(host, {maxLength: 6})
const manifest = fc.record(
  {
    manifest_version: fc.constantFrom(2, 3),
    name: fc.constant('prop'),
    permissions: declared,
    host_permissions: hosts,
    optional_permissions: declared,
    optional_host_permissions: hosts
  },
  {requiredKeys: ['manifest_version', 'name']}
)
type Input = typeof manifest extends fc.Arbitrary<infer T> ? T : never

// The writer spreads the override over the source manifest and then drops the
// mv2 host keys, so the property composes the same way.
const fold = (m: Input) =>
  dropMv2HostKeys({...m, ...hostPermissions(m as any)}) as Record<
    string,
    string[] | undefined
  >

const PAIRS = [
  ['permissions', 'host_permissions'],
  ['optional_permissions', 'optional_host_permissions']
] as const

describe('mv2 host_permissions fold properties', () => {
  it('on mv2 folds every host once, after the declared permissions, and drops the host keys', () => {
    fc.assert(
      fc.property(
        manifest.filter((m) => m.manifest_version === 2),
        (m) => {
          const out = fold(m)
          expect('host_permissions' in out).toBe(false)
          expect('optional_host_permissions' in out).toBe(false)

          for (const [permKey, hostKey] of PAIRS) {
            const input = m as Partial<Record<string, string[]>>

            if (!input[hostKey]) {
              // Nothing to fold, so the declared list passes through untouched.
              expect(out[permKey]).toEqual(input[permKey])
              continue
            }

            const folded = out[permKey] ?? []
            const declaredList = input[permKey] ?? []
            expect(folded.slice(0, declaredList.length)).toEqual(declaredList)

            for (const pattern of new Set(input[hostKey])) {
              expect(folded.filter((entry) => entry === pattern)).toHaveLength(
                1
              )
            }

            expect(new Set(folded).size).toBe(folded.length)
            expect(folded).toHaveLength(
              new Set([...declaredList, ...input[hostKey]]).size
            )
          }
        }
      ),
      RUNS
    )
  })

  it('on mv3 returns the manifest untouched', () => {
    fc.assert(
      fc.property(
        manifest.filter((m) => m.manifest_version === 3),
        (m) => {
          expect(hostPermissions(m as any)).toBeUndefined()
          expect(dropMv2HostKeys(m)).toBe(m)
          expect(fold(m)).toEqual(m)
        }
      ),
      RUNS
    )
  })
})
