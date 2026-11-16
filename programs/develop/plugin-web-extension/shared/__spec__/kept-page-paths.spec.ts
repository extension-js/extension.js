import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../types'
import {
  applyKeptPagePaths,
  type KeptPagePath,
  keepPagePath,
  keptPagePaths,
  namesPagePath,
  pageServedAtAuthoredPath
} from '../kept-page-paths'

function kept(pages: Array<[string, string]>): Map<string, KeptPagePath> {
  return new Map(
    pages.map(([output, authored]) => [
      output,
      {output, authored, mentionedIn: 'background.js:1'}
    ])
  )
}

describe('namesPagePath', () => {
  const page = 'ui/popup/index.html'

  it('reads the authored path however a string reaches it', () => {
    for (const literal of [
      'ui/popup/index.html',
      '/ui/popup/index.html',
      './ui/popup/index.html',
      '../ui/popup/index.html',
      '../../ui/popup/index.html',
      '/ui/popup/index.html?tab=1',
      'ui/popup/index.html#settings',
      'chrome-extension://abcdefghijklmnop/ui/popup/index.html',
      'moz-extension://0f0f/ui/popup/index.html'
    ]) {
      expect(namesPagePath(literal, page), literal).toBe(true)
    }
  })

  it('leaves a longer path that only ends the same way alone', () => {
    for (const literal of [
      'other/ui/popup/index.html',
      'xui/popup/index.html',
      'popup/index.html',
      'index.html',
      'ui/popup/index.htm',
      'https://example.com/docs/ui/popup/index.html',
      ''
    ]) {
      expect(namesPagePath(literal, page), literal).toBe(false)
    }
  })

  it('reads a page at the root by its bare name', () => {
    expect(namesPagePath('popup.html', 'popup.html')).toBe(true)
    expect(namesPagePath('/popup.html', './popup.html')).toBe(true)
    expect(namesPagePath('pages/popup.html', 'popup.html')).toBe(false)
    expect(namesPagePath('mypopup.html', 'popup.html')).toBe(false)
  })
})

describe('pageServedAtAuthoredPath', () => {
  it('serves the options page when the keys share one source', () => {
    expect(
      pageServedAtAuthoredPath(['action/index.html', 'options/index.html'])
    ).toBe('options/index.html')
  })

  it('serves the first compiled page otherwise', () => {
    expect(
      pageServedAtAuthoredPath(['action/index.html', 'page_action/index.html'])
    ).toBe('action/index.html')
  })
})

describe('keptPagePaths', () => {
  it('holds the pages of one compilation and nothing of another', () => {
    const compilation = {}
    const page = {
      output: 'action/index.html',
      authored: 'popup.html',
      mentionedIn: 'background.js:3'
    }

    keepPagePath(compilation, page)
    keepPagePath(compilation, {...page, mentionedIn: 'other.js:9'})

    expect([...keptPagePaths(compilation).values()]).toEqual([page])
    expect(keptPagePaths({}).size).toBe(0)
  })
})

describe('applyKeptPagePaths', () => {
  it('points every key that names a kept page at the authored path', () => {
    const manifest = {
      manifest_version: 3,
      action: {default_title: 'T', default_popup: 'action/index.html'},
      options_ui: {page: 'options/index.html', open_in_tab: false},
      devtools_page: 'devtools/index.html',
      side_panel: {default_path: 'sidebar/index.html'},
      chrome_url_overrides: {newtab: 'chrome_url_overrides/newtab.html'},
      sandbox: {pages: ['sandbox/page-0.html', 'sandbox/page-1.html']}
    } as unknown as Manifest

    const {manifest: next, applied} = applyKeptPagePaths(
      manifest,
      kept([
        ['action/index.html', 'ui/popup/index.html'],
        ['options/index.html', 'ui/popup/index.html'],
        ['devtools/index.html', 'devtools.html'],
        ['chrome_url_overrides/newtab.html', 'newtab/index.html'],
        ['sandbox/page-1.html', 'sandbox/frame.html']
      ])
    )

    expect(next).toEqual({
      manifest_version: 3,
      action: {default_title: 'T', default_popup: 'ui/popup/index.html'},
      options_ui: {page: 'ui/popup/index.html', open_in_tab: false},
      devtools_page: 'devtools.html',
      side_panel: {default_path: 'sidebar/index.html'},
      chrome_url_overrides: {newtab: 'newtab/index.html'},
      sandbox: {pages: ['sandbox/page-0.html', 'sandbox/frame.html']}
    })

    expect(applied.map((page) => page.field)).toEqual([
      'action.default_popup',
      'options_ui.page',
      'devtools_page',
      'chrome_url_overrides.newtab',
      'sandbox.pages[1]'
    ])
  })

  it('reads the Manifest V2 keys the same way', () => {
    const {manifest: next} = applyKeptPagePaths(
      {
        manifest_version: 2,
        browser_action: {default_popup: 'action/index.html'},
        page_action: {default_popup: 'page_action/index.html'},
        options_page: 'options/index.html',
        sidebar_action: {default_panel: 'sidebar/index.html'}
      } as unknown as Manifest,
      kept([
        ['action/index.html', 'popup.html'],
        ['page_action/index.html', 'page.html'],
        ['options/index.html', 'options.html'],
        ['sidebar/index.html', 'panel.html']
      ])
    )

    expect(next).toMatchObject({
      browser_action: {default_popup: 'popup.html'},
      page_action: {default_popup: 'page.html'},
      options_page: 'options.html',
      sidebar_action: {default_panel: 'panel.html'}
    })
  })

  it('returns the manifest as built when no page is kept', () => {
    const manifest = {
      action: {default_popup: 'action/index.html'}
    } as unknown as Manifest

    const result = applyKeptPagePaths(manifest, new Map())

    expect(result.manifest).toBe(manifest)
    expect(result.applied).toEqual([])
  })

  it('leaves the background page and unrelated strings alone', () => {
    const manifest = {
      background: {page: 'action/index.html'},
      name: 'action/index.html',
      action: {default_title: 'action/index.html'}
    } as unknown as Manifest

    expect(
      applyKeptPagePaths(manifest, kept([['action/index.html', 'popup.html']]))
        .manifest
    ).toEqual(manifest)
  })
})
