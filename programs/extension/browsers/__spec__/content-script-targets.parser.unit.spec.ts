// Parser spec for the extension-side `parseCanonicalContentScriptEntryIndex`.
//
// This function was the silent half of the April 2026 content-script reload
// regression: it returned `undefined` for hashed asset names (e.g.
// `content_scripts/content-0.d4c18981.js`) because the implementation did
// `Number(suffix)` which yields NaN once a hash is present.
//
// If this table is green, every downstream rule-resolution path (including
// `selectContentScriptRules`) correctly maps hashed and unhashed assets back
// to their content-script index.

import {describe, expect, it} from 'vitest'
import {parseCanonicalContentScriptEntryIndex} from '../browsers-lib/content-script-targets'

describe('parseCanonicalContentScriptEntryIndex', () => {
  const cases: Array<{input: unknown; expected: number | undefined}> = [
    // Plain canonical entry names (no extension)
    {input: 'content_scripts/content-0', expected: 0},
    {input: 'content_scripts/content-1', expected: 1},
    {input: 'content_scripts/content-12', expected: 12},

    // Unhashed asset names
    {input: 'content_scripts/content-0.js', expected: 0},
    {input: 'content_scripts/content-0.css', expected: 0},
    {input: 'content_scripts/content-5.JS', expected: 5},

    // Hashed asset names — the exact pattern the dev bundler emits
    {input: 'content_scripts/content-0.d4c18981.js', expected: 0},
    {input: 'content_scripts/content-12.abcd1234.css', expected: 12},
    {input: 'content_scripts/content-3.DEADBEEF.js', expected: 3},

    // Not a content-script entry — must return undefined
    {input: 'background/service_worker.js', expected: undefined},
    {input: 'content_scripts/content-', expected: undefined},
    {input: 'content_scripts/content-abc', expected: undefined},
    {input: 'content_scripts/content--1', expected: undefined},
    {input: 'scripts/content-0', expected: undefined},
    {input: '', expected: undefined},

    // Non-string defenses
    {input: null, expected: undefined},
    {input: undefined, expected: undefined},
    {input: 42, expected: undefined}
  ]

  for (const {input, expected} of cases) {
    it(`maps ${JSON.stringify(input)} → ${String(expected)}`, () => {
      expect(parseCanonicalContentScriptEntryIndex(input as any)).toBe(expected)
    })
  }
})
