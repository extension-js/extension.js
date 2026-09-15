import fc from 'fast-check'
import {describe, expect, it} from 'vitest'
import type {DevOptions} from '../../types'
import {filterKeysForThisBrowser} from '../manifest-utils'

type Browser = DevOptions['browser']
type Tier = 'specific' | 'family' | 'foreign'

// Which prefixes each target treats as its own, its engine family, or
// somebody else's. Safari inherits the chromium family for manifest keys.
// chrome: and edge: are vendor exact, foreign to every other target.
const TARGETS: Record<string, Record<Tier, string[]>> = {
  chrome: {
    specific: ['chrome'],
    family: ['chromium'],
    foreign: ['edge', 'firefox', 'gecko', 'safari', 'webkit']
  },
  edge: {
    specific: ['edge'],
    family: ['chromium'],
    foreign: ['chrome', 'firefox', 'gecko', 'safari', 'webkit']
  },
  chromium: {
    specific: ['chromium'],
    family: [],
    foreign: ['chrome', 'edge', 'firefox', 'gecko', 'safari', 'webkit']
  },
  brave: {
    specific: ['brave'],
    family: ['chromium'],
    foreign: ['chrome', 'edge', 'firefox', 'gecko', 'safari', 'webkit']
  },
  firefox: {
    specific: ['firefox'],
    family: ['gecko'],
    foreign: ['brave', 'chrome', 'chromium', 'edge', 'safari', 'webkit']
  },
  safari: {
    specific: ['safari', 'webkit'],
    family: ['chromium'],
    foreign: ['brave', 'chrome', 'edge', 'firefox', 'gecko']
  }
}

const RUNS = {numRuns: 200}
const target = fc.constantFrom(...Object.keys(TARGETS))
// Integer-like keys would be reordered by Object.entries, so keys stay alphabetic.
const plainKey = fc.stringMatching(/^[a-z_]{1,12}$/)
const shuffle = <T>(items: T[]) =>
  fc.shuffledSubarray(items, {minLength: items.length})

// One plain key plus a random subset of its prefixed twins, in random source
// order. Every value names its own tier so the winner is legible in a failure.
const twins = (browser: string) =>
  fc
    .record({
      key: plainKey,
      plain: fc.boolean(),
      specific: fc.subarray(TARGETS[browser].specific),
      family: fc.subarray(TARGETS[browser].family),
      foreign: fc.subarray(TARGETS[browser].foreign),
      depth: fc.nat({max: 3})
    })
    .chain((s) => {
      const entries: Array<[string, string]> = []
      if (s.plain) entries.push([s.key, 'plain'])
      for (const tier of ['specific', 'family', 'foreign'] as const)
        for (const p of s[tier]) entries.push([`${p}:${s.key}`, `${tier}:${p}`])
      return shuffle(entries).map((order) => ({...s, entries: order}))
    })

// Bury the object under alternating plain-key objects and arrays so the
// invariants are exercised at every level the resolver recurses through.
const wrap = (node: unknown, depth: number): unknown =>
  depth === 0 ? node : wrap(depth % 2 ? {inner: node} : [node], depth - 1)
// wrap adds the depth-1 layer last, so peeling starts from layer one.
const unwrap = (node: any, depth: number): any => {
  let current = node
  for (let layer = 1; layer <= depth; layer++)
    current = layer % 2 ? current.inner : current[0]
  return current
}

const filter = (manifest: unknown, browser: string) =>
  filterKeysForThisBrowser(manifest as any, browser as Browser) as any

const allKeys = (node: unknown): string[] =>
  Array.isArray(node)
    ? node.flatMap(allKeys)
    : node && typeof node === 'object'
      ? Object.entries(node).flatMap(([k, v]) => [k, ...allKeys(v)])
      : []

describe('filterKeysForThisBrowser properties', () => {
  it('resolves plain < family < specific regardless of source order', () => {
    fc.assert(
      fc.property(
        target.chain((b) => twins(b).map((t) => ({browser: b, ...t}))),
        ({browser, key, entries, plain, specific, family, depth}) => {
          const input = wrap(Object.fromEntries(entries), depth)
          const out = unwrap(filter(input, browser), depth)
          const winner = specific.length
            ? 'specific'
            : family.length
              ? 'family'
              : plain
                ? 'plain'
                : undefined
          if (!winner) {
            expect(out).toEqual({})
            return
          }
          expect(Object.keys(out)).toEqual([key])
          expect(String(out[key]).split(':')[0]).toBe(winner)
        }
      ),
      RUNS
    )
  })

  it('never emits a prefixed key and never leaks a foreign family value', () => {
    // Foreign values carry a sentinel nothing else in the manifest contains.
    const value = fc.oneof(fc.string(), fc.integer(), fc.constant(null))
    const node = fc.letrec((tie) => ({
      leaf: value,
      obj: fc.dictionary(
        fc.oneof(
          plainKey,
          fc
            .tuple(
              fc.constantFrom(
                'brave',
                'chrome',
                'chromium',
                'edge',
                'firefox',
                'gecko',
                'safari',
                'webkit'
              ),
              plainKey
            )
            .map(([p, k]) => `${p}:${k}`)
        ),
        fc.oneof({depthSize: 'small'}, tie('leaf'), tie('obj'), tie('arr'))
      ),
      arr: fc.array(fc.oneof({depthSize: 'small'}, tie('leaf'), tie('obj')), {
        maxLength: 3
      })
    })).obj
    fc.assert(
      fc.property(target, node, (browser, manifest) => {
        const tagged = JSON.parse(
          JSON.stringify(manifest, (k, v) =>
            TARGETS[browser].foreign.some((p) => k.startsWith(`${p}:`))
              ? '<<leak>>'
              : v
          )
        )
        const out = filter(tagged, browser)
        expect(JSON.stringify(out)).not.toContain('<<leak>>')
        expect(allKeys(out).filter((k) => k.includes(':'))).toEqual([])
        // Idempotence: a resolved manifest has nothing left to resolve.
        expect(filter(out, browser)).toEqual(out)
      }),
      RUNS
    )
  })

  it('never throws for any JSON-shaped input', () => {
    fc.assert(
      fc.property(target, fc.jsonValue(), (browser, json) => {
        expect(() => filter(json, browser)).not.toThrow()
      }),
      RUNS
    )
  })
})
