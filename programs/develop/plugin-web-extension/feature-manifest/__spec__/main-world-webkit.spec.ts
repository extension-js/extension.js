import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../types'
import {buildCanonicalManifest} from '../manifest-lib/manifest'

// MDN browser-compat-data gives content_scripts[].world version_added 18 for
// safari and 128 for firefox, so every family keeps the key and the bridge
// that feeds the MAIN world its extension base URL.
const source = {
  name: 'x',
  version: '1.0.0',
  manifest_version: 3,
  content_scripts: [
    {matches: ['<all_urls>'], js: ['isolated.js']},
    {matches: ['<all_urls>'], js: ['main.js'], world: 'MAIN'}
  ]
} as unknown as Manifest

const SAFARI_FILTER = path.join(
  __dirname,
  '..',
  'manifest-lib',
  'filter-keys-safari.ts'
)

describe('MAIN world survives every family', () => {
  it.each([
    'chrome',
    'firefox',
    'safari'
  ])('keeps the world key and its bridge entry for %s', (browser) => {
    const result = buildCanonicalManifest(
      '/p/manifest.json',
      source,
      browser as never
    ) as Manifest

    const entries = result.content_scripts || []
    expect(entries).toHaveLength(3)
    // The bridge rides in the isolated world ahead of the MAIN entry.
    expect(entries[1].js).toEqual(['content_scripts/content-2.js'])
    expect(entries[1]).not.toHaveProperty('world')
    expect(entries[2]).toMatchObject({
      world: 'MAIN',
      js: ['content_scripts/content-1.js']
    })
  })

  // The drop was written, wired to a constant false and left behind the gate,
  // so a reader could not tell a decision from an unfinished feature.
  it('carries no disabled drop gate in the webkit filter', () => {
    const contents = fs.readFileSync(SAFARI_FILTER, 'utf8')

    expect(contents).not.toContain('DROP_CONTENT_SCRIPT_WORLD')
    expect(contents).not.toMatch(/^const \w+ = false$/m)
  })
})
