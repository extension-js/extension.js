import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX,
  EXTENSIONJS_CONTENT_SCRIPT_LAYER,
  getCanonicalContentScriptCssAssetName,
  getCanonicalContentScriptEntryName,
  getCanonicalContentScriptJsAssetName,
  isCanonicalContentScriptAsset,
  isCanonicalContentScriptEntryName,
  isDevContentScriptStandInAsset,
  isPlainContentScriptAsset,
  parseCanonicalContentScriptAsset,
  parseCanonicalContentScriptEntryIndex,
  parseHashedContentScriptAsset
} from '../contracts'

const developRoot = path.resolve(__dirname, '..', '..', '..')

function productSources(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (['node_modules', 'dist', '__spec__'].includes(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) productSources(full, found)
    else if (
      /\.[cm]?[jt]sx?$/.test(entry.name) &&
      !entry.name.includes('.spec.')
    )
      {found.push(full)}
  }

  return found
}

describe('feature-scripts contract helpers', () => {
  it('exposes the canonical layer and entry prefix', () => {
    expect(EXTENSIONJS_CONTENT_SCRIPT_LAYER).toBe('extensionjs-content-script')
    expect(CANONICAL_CONTENT_SCRIPT_ENTRY_PREFIX).toBe(
      'content_scripts/content-'
    )
  })

  it('builds canonical content script entry and asset names', () => {
    expect(getCanonicalContentScriptEntryName(7)).toBe(
      'content_scripts/content-7'
    )

    expect(getCanonicalContentScriptJsAssetName(7)).toBe(
      'content_scripts/content-7.js'
    )

    expect(getCanonicalContentScriptCssAssetName(7)).toBe(
      'content_scripts/content-7.css'
    )
  })

  it('parses canonical entry and asset names', () => {
    expect(
      parseCanonicalContentScriptEntryIndex('content_scripts/content-3')
    ).toBe(3)

    expect(
      parseCanonicalContentScriptEntryIndex('scripts/content-3')
    ).toBeUndefined()

    expect(
      parseCanonicalContentScriptAsset('content_scripts/content-4.js')
    ).toEqual({
      index: 4,
      extension: 'js'
    })

    expect(
      parseCanonicalContentScriptAsset('content_scripts/content-4.css')
    ).toEqual({
      index: 4,
      extension: 'css'
    })

    expect(
      parseCanonicalContentScriptAsset('content_scripts/content-4.a1b2c3d4.js')
    ).toEqual({
      index: 4,
      extension: 'js',
      hash: 'a1b2c3d4'
    })

    expect(
      parseCanonicalContentScriptAsset('content_scripts/content-4.deadbeef.css')
    ).toEqual({
      index: 4,
      extension: 'css',
      hash: 'deadbeef'
    })

    expect(
      parseCanonicalContentScriptAsset('content_scripts/content-4.js.map')
    ).toBeUndefined()
  })

  it('validates canonical entry and asset names', () => {
    expect(isCanonicalContentScriptEntryName('content_scripts/content-0')).toBe(
      true
    )

    expect(isCanonicalContentScriptEntryName('content_scripts/content-a')).toBe(
      false
    )

    expect(isCanonicalContentScriptAsset('content_scripts/content-0.js')).toBe(
      true
    )

    expect(isCanonicalContentScriptAsset('content_scripts/content-0.css')).toBe(
      true
    )

    expect(isCanonicalContentScriptAsset('content_scripts/content-0.svg')).toBe(
      false
    )

    expect(
      isCanonicalContentScriptAsset('content_scripts/content-0.abcdef12.js')
    ).toBe(true)
  })

  it('tells a dev session file from a content script bundle', () => {
    for (const name of [
      'content_scripts/dev-stub-0.js',
      'content_scripts/dev-css-12.js',
      'content_scripts/dev-sheet-2.css'
    ]) {
      expect(isDevContentScriptStandInAsset(name)).toBe(true)
    }

    for (const name of [
      'content_scripts/content-2.css',
      'content_scripts/content-2.js',
      'content_scripts/dev-registry.json',
      'content_scripts/dev-sheet-2.js',
      'content_scripts/dev-stub-2.css',
      'content_scripts/dev-stub-.js',
      'nested/content_scripts/dev-stub-2.js',
      'content_scripts/dev-stub-2.js.map'
    ]) {
      expect(isDevContentScriptStandInAsset(name)).toBe(false)
    }
  })
})

describe('the content script naming rule', () => {
  it('tells a plain asset name from a hashed one', () => {
    expect(
      isPlainContentScriptAsset('content_scripts/content-4.css', 'css')
    ).toBe(true)

    expect(
      isPlainContentScriptAsset('content_scripts/content-4.js', 'css')
    ).toBe(false)

    expect(
      isPlainContentScriptAsset('content_scripts/content-4.a1b2c3d4.js', 'js')
    ).toBe(false)

    expect(isPlainContentScriptAsset('scripts/content-4.js', 'js')).toBe(false)

    expect(
      parseHashedContentScriptAsset(
        'content_scripts/content-4.a1b2c3d4.js',
        'js'
      )
    ).toEqual({index: 4, hash: 'a1b2c3d4'})

    expect(
      parseHashedContentScriptAsset('content_scripts/content-4.js', 'js')
    ).toBeUndefined()

    expect(
      parseHashedContentScriptAsset(
        'content_scripts/content-4.a1b2c3d4.css',
        'js'
      )
    ).toBeUndefined()
  })

  // A second spelling of the name agrees with this file only until one of
  // the two is edited, so every product file asks the helpers here.
  it('is spelled in the contracts file and nowhere else in product source', () => {
    const spelling = productSources(developRoot)
      .filter((file) => {
        const code = fs
          .readFileSync(file, 'utf8')
          .replace(/\r\n/g, '\n')
          .split('\n')
          .filter((line) => !line.trimStart().startsWith('//'))
          .join('\n')

        return (
          code.includes('content_scripts/content-') ||
          code.includes('content_scripts\\/content-')
        )
      })
      .map((file) => path.relative(developRoot, file).split(path.sep).join('/'))

    expect(spelling).toEqual([
      'plugin-web-extension/feature-scripts/contracts.ts'
    ])
  })
})
