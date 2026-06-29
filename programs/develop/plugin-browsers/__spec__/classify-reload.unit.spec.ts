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

  it('a page-only edit with no content scripts → undefined (livereload owns it)', () => {
    expect(
      classifyReloadFromSources({
        changedSources: ['src/popup/index.js'],
        getContentScriptCount: count(0)
      })
    ).toBeUndefined()
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
