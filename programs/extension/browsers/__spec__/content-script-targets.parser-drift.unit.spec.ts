// Drift sentinel: the extension and develop packages each carry their own
// implementation of `parseCanonicalContentScriptEntryIndex`. The April 2026
// regression existed precisely because the two copies diverged — the develop
// copy used a strict regex and handled hashed assets via a separate parser,
// while the extension copy stripped the prefix and called `Number(suffix)`
// which returns NaN once a hash is present.
//
// This spec imports BOTH implementations and asserts they agree on a shared
// fixture table. If they drift again, this test fails and points at the file
// that regressed.

import {describe, expect, it} from 'vitest'
import {parseCanonicalContentScriptEntryIndex as extensionParse} from '../browsers-lib/content-script-targets'
import {
  parseCanonicalContentScriptEntryIndex as developParse,
  parseCanonicalContentScriptAsset as developParseAsset
} from '../../../develop/plugin-web-extension/feature-scripts/contracts'

// Inputs the two copies must agree on. These cover every shape the bundler
// actually emits (canonical entry name, unhashed asset, hashed asset) plus the
// obvious rejects.
const SHARED_FIXTURES: Array<{input: string; expected: number | undefined}> = [
  // Canonical entry names
  {input: 'content_scripts/content-0', expected: 0},
  {input: 'content_scripts/content-1', expected: 1},
  {input: 'content_scripts/content-12', expected: 12},

  // Unhashed asset names
  {input: 'content_scripts/content-0.js', expected: 0},
  {input: 'content_scripts/content-0.css', expected: 0},

  // Hashed asset names (the actual dev-mode emission)
  {input: 'content_scripts/content-0.d4c18981.js', expected: 0},
  {input: 'content_scripts/content-12.abcd1234.css', expected: 12},

  // Must reject
  {input: 'background/service_worker.js', expected: undefined},
  {input: 'scripts/content-0', expected: undefined},
  {input: 'content_scripts/content-abc', expected: undefined},
  {input: 'content_scripts/content-', expected: undefined},
  {input: '', expected: undefined}
]

describe('parser drift sentinel', () => {
  for (const {input, expected} of SHARED_FIXTURES) {
    it(`extension and develop agree on ${JSON.stringify(input)}`, () => {
      // `developParse` is the strict entry-name form (no hash/extension).
      // `developParseAsset` covers hashed assets. The extension-side parser
      // handles both shapes in a single function. To make the agreement
      // claim precise, we compare extension's result with whichever develop
      // helper applies to the input shape.
      const extResult = extensionParse(input)
      const isAssetShape = /\.(js|css)$/i.test(input)
      const devResult = isAssetShape
        ? developParseAsset(input)?.index
        : developParse(input)

      expect(extResult).toBe(expected)
      expect(devResult).toBe(expected)
      expect(extResult).toBe(devResult)
    })
  }
})
