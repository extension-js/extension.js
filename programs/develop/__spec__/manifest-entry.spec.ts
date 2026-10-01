import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  filterKeysForThisBrowser,
  findDroppedVendorKeys
} from '../manifest-entry'

describe('the public manifest entry', () => {
  it('resolves the prefix convention for a project with its own build', () => {
    const manifest = {
      manifest_version: 3,
      name: 'x',
      'chromium:background': {service_worker: 'sw.js'},
      'firefox:background': {scripts: ['bg.js']},
      'safari:background': {scripts: ['safari.js']}
    } as any

    expect(filterKeysForThisBrowser(manifest, 'chrome').background).toEqual({
      service_worker: 'sw.js'
    })

    expect(filterKeysForThisBrowser(manifest, 'firefox').background).toEqual({
      scripts: ['bg.js']
    })

    expect(filterKeysForThisBrowser(manifest, 'safari').background).toEqual({
      scripts: ['safari.js']
    })

    expect(typeof findDroppedVendorKeys).toBe('function')
  })

  it('takes the fallback prefixes a build names, below its own', () => {
    const manifest = {
      manifest_version: 3,
      name: 'x',
      'firefox:background': {scripts: ['bg.js']},
      'firefox:browser_specific_settings': {gecko: {id: 'x@y'}},
      'safari:browser_specific_settings': {safari: {strict_min_version: '17'}}
    } as any

    expect(filterKeysForThisBrowser(manifest, 'safari')).toEqual({
      manifest_version: 3,
      name: 'x',
      browser_specific_settings: {safari: {strict_min_version: '17'}}
    })

    expect(
      filterKeysForThisBrowser(manifest, 'safari', {fallbacks: ['firefox:']})
    ).toEqual({
      manifest_version: 3,
      name: 'x',
      background: {scripts: ['bg.js']},
      browser_specific_settings: {safari: {strict_min_version: '17'}}
    })

    expect(
      filterKeysForThisBrowser(manifest, 'chrome', {fallbacks: ['firefox']})
        .background
    ).toEqual({scripts: ['bg.js']})
  })

  it('is published under ./manifest next to the other entries', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    )

    expect(pkg.exports['./manifest']).toEqual({
      development: './manifest-entry.ts',
      types: './dist/manifest-entry.d.ts',
      import: './dist/manifest.mjs'
    })
  })
})
