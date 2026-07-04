// Unit spec for the pure reload classifier shared by the launched-browser path
// (BrowsersPlugin) and the controller-less `--no-browser` reload broadcast.
// Keeping both paths on one classifier guarantees a given change reloads
// identically whether or not a browser was launched.

import {describe, expect, it} from 'vitest'
import {classifyReloadFromSources} from '../index'

const count = (n: number) => () => n

describe('classifyReloadFromSources', () => {
  it('returns undefined when nothing changed', () => {
    expect(
      classifyReloadFromSources({
        changedSources: [],
        getContentScriptCount: count(3)
      })
    ).toBeUndefined()
  })

  it('a manifest/_locales change forces a full reload', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/content/scripts.js'],
        forcedFull: true,
        getContentScriptCount: count(1)
      })
    ).toMatchObject({type: 'full'})
  })

  it('a background/service-worker source change → service-worker', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/background.ts'],
        getContentScriptCount: count(1)
      })
    ).toMatchObject({type: 'service-worker'})
  })

  it('a content source change with declared content scripts → content-scripts with canonical entries', () => {
    const result = classifyReloadFromSources({
      changedSources: ['src/content/scripts.js'],
      getContentScriptCount: count(2)
    })
    expect(result?.type).toBe('content-scripts')
    expect(result?.changedContentScriptEntries).toHaveLength(2)
    expect(result?.changedAssets).toEqual(['src/content/scripts.js'])
  })

  it('a page-only edit with no content scripts → notify-only "page" (livereload owns the refresh)', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/popup/index.js'],
        getContentScriptCount: count(0)
      })
    ).toMatchObject({
      type: 'page',
      label: 'popup page (src/popup/index.js)'
    })
  })

  it('builds the shared context label for every classification', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/manifest.json'],
        forcedFull: true,
        getContentScriptCount: count(1)
      })?.label
    ).toBe('extension (src/manifest.json)')

    expect(
      classifyReloadFromSources({
        changedSources: ['src/background.ts'],
        getContentScriptCount: count(1)
      })?.label
    ).toBe('service_worker (src/background.ts)')

    expect(
      classifyReloadFromSources({
        changedSources: ['src/content/scripts.js'],
        getContentScriptCount: count(1)
      })?.label
    ).toBe('content_script (src/content/scripts.js)')

    expect(
      classifyReloadFromSources({
        changedSources: ['src/sidebar/index.tsx'],
        getContentScriptCount: count(0)
      })?.label
    ).toBe('sidebar page (src/sidebar/index.tsx)')
  })

  it('caps the label file list at two entries', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
        forcedFull: true,
        getContentScriptCount: count(0)
      })?.label
    ).toBe('extension (src/a.ts, src/b.ts +2 more)')
  })

  it('does not read the content-script count when classification resolves earlier', () => {
    let called = 0
    classifyReloadFromSources({
      changedSources: ['src/background.ts'],
      getContentScriptCount: () => {
        called++
        return 1
      }
    })
    expect(called).toBe(0)
  })
})
