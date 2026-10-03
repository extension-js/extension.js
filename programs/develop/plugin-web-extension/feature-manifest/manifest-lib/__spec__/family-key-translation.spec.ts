import {describe, expect, it} from 'vitest'
import type {Manifest} from '../../../../types'
import {buildCanonicalManifest} from '../manifest'

function canonical(manifest: Record<string, unknown>, browser: string) {
  return buildCanonicalManifest(
    '/p/manifest.json',
    manifest as unknown as Manifest,
    browser as never
  ) as Record<string, any>
}

describe('sidebar pair translation', () => {
  const sidebarActionOnly = {
    name: 'x',
    version: '1.0.0',
    manifest_version: 3,
    sidebar_action: {default_panel: 'sidebar.html', default_title: 'Side'}
  }

  const sidePanelOnly = {
    name: 'x',
    version: '1.0.0',
    manifest_version: 3,
    side_panel: {default_path: 'sidebar.html'}
  }

  it.each([
    'chrome',
    'edge',
    'chromium-based'
  ])('writes a sidebar_action-only manifest as side_panel for %s', (browser) => {
    const result = canonical(sidebarActionOnly, browser)

    expect(result.side_panel).toEqual({default_path: 'sidebar/index.html'})
    expect(result).not.toHaveProperty('sidebar_action')
    // Chromium shows no panel without the permission beside the key.
    expect(result.permissions).toEqual(['sidePanel'])
  })

  it('adds the sidePanel permission once beside the ones declared', () => {
    const result = canonical(
      {...sidebarActionOnly, permissions: ['storage', 'sidePanel']},
      'chrome'
    )

    expect(result.permissions).toEqual(['storage', 'sidePanel'])
    expect(result.side_panel).toEqual({default_path: 'sidebar/index.html'})
  })

  it.each([
    'firefox',
    'zen',
    'gecko-based'
  ])('writes a side_panel-only manifest as sidebar_action for %s', (browser) => {
    const result = canonical(sidePanelOnly, browser)

    expect(result.sidebar_action).toEqual({
      default_panel: 'sidebar/index.html'
    })

    expect(result).not.toHaveProperty('side_panel')
  })

  it('turns off browser_style on a translated Manifest V2 sidebar_action', () => {
    // Firefox defaults the key to true on MV2 and styles the panel, which
    // Chromium never did to the side_panel page this manifest declared.
    const result = canonical(
      {...sidePanelOnly, 'firefox:manifest_version': 2},
      'firefox'
    )

    expect(result.manifest_version).toBe(2)
    expect(result.sidebar_action).toEqual({
      default_panel: 'sidebar/index.html',
      browser_style: false
    })
  })

  it('keeps a browser_style the manifest set on the translated key', () => {
    const result = canonical(
      {
        ...sidePanelOnly,
        'firefox:manifest_version': 2,
        side_panel: {default_path: 'sidebar.html', browser_style: true}
      },
      'firefox'
    )

    expect(result.sidebar_action.browser_style).toBe(true)
  })

  it('leaves each family its own key when the manifest names both', () => {
    const both = {
      name: 'x',
      version: '1.0.0',
      manifest_version: 3,
      side_panel: {default_path: 'chromiumpanel.html'},
      sidebar_action: {default_panel: 'geckopanel.html'}
    }

    for (const browser of ['chrome', 'firefox']) {
      const result = canonical(both, browser)

      expect(result.side_panel).toEqual({default_path: 'sidebar/index.html'})
      expect(result.sidebar_action.default_panel).toBe(
        'sidebar_action/index.html'
      )
    }
  })

  it('keeps sidebar_action on opera, which reads the key itself', () => {
    const result = canonical(sidebarActionOnly, 'opera')

    expect(result.sidebar_action.default_panel).toBe('sidebar/index.html')
    expect(result).not.toHaveProperty('side_panel')
    expect(result).not.toHaveProperty('permissions')
  })

  it('keeps sidebar_action on a Manifest V2 chromium build', () => {
    const result = canonical(
      {...sidebarActionOnly, manifest_version: 2},
      'chrome'
    )

    expect(result.sidebar_action.default_panel).toBe('sidebar/index.html')
    expect(result).not.toHaveProperty('side_panel')
    expect(result).not.toHaveProperty('permissions')
  })

  it('never rewrites a key the manifest declared without a page', () => {
    const gecko = canonical(
      {...sidePanelOnly, sidebar_action: {default_title: 'Mine'}},
      'firefox'
    )

    expect(gecko.sidebar_action).toEqual({default_title: 'Mine'})
    expect(gecko.side_panel).toEqual({default_path: 'sidebar/index.html'})

    const chromium = canonical({...sidebarActionOnly, side_panel: {}}, 'chrome')

    expect(chromium.side_panel).toEqual({})
    expect(chromium).not.toHaveProperty('permissions')
  })

  it('keeps sidebar_action on a safari build, which has no side panel', () => {
    const result = canonical(sidebarActionOnly, 'safari')

    expect(result.sidebar_action.default_panel).toBe('sidebar/index.html')
    expect(result).not.toHaveProperty('side_panel')
  })
})

describe('toolbar key translation for a resolved Manifest V2 build', () => {
  const crossBrowser = {
    name: 'x',
    version: '1.0.0',
    manifest_version: 3,
    'firefox:manifest_version': 2,
    action: {default_popup: 'popup.html', default_title: 'Pop'}
  }

  it('writes action as browser_action when the build resolves to version 2', () => {
    const result = canonical(crossBrowser, 'firefox')

    expect(result.manifest_version).toBe(2)
    expect(result.browser_action).toEqual({
      default_popup: 'action/index.html',
      default_title: 'Pop'
    })

    expect(result).not.toHaveProperty('action')
  })

  it('moves the reserved shortcut to the name Manifest V2 binds', () => {
    const result = canonical(
      {
        ...crossBrowser,
        commands: {
          _execute_action: {suggested_key: {default: 'Ctrl+Shift+Y'}},
          other: {description: 'Other'}
        }
      },
      'firefox'
    )

    expect(result.commands).toEqual({
      other: {description: 'Other'},
      _execute_browser_action: {suggested_key: {default: 'Ctrl+Shift+Y'}}
    })
  })

  it('drops page_action beside a translated action on Manifest V2 chromium', () => {
    const result = canonical(
      {
        name: 'x',
        version: '1.0.0',
        manifest_version: 2,
        action: {default_popup: 'popup.html'},
        page_action: {default_popup: 'page.html'}
      },
      'chrome'
    )

    expect(result.browser_action.default_popup).toBe('action/index.html')
    expect(result).not.toHaveProperty('page_action')
    expect(result).not.toHaveProperty('action')
  })

  it('keeps action on the chromium build of the same manifest', () => {
    const result = canonical(crossBrowser, 'chrome')

    expect(result.manifest_version).toBe(3)
    expect(result.action.default_popup).toBe('action/index.html')
    expect(result).not.toHaveProperty('browser_action')
  })

  it('leaves a manifest that already names both keys alone', () => {
    const result = canonical(
      {
        name: 'x',
        version: '1.0.0',
        manifest_version: 2,
        action: {default_popup: 'chromiumpopup.html'},
        browser_action: {default_popup: 'geckopopup.html'}
      },
      'firefox'
    )

    expect(result.action.default_popup).toBe('action/index.html')
    expect(result.browser_action.default_popup).toBe(
      'browser_action/index.html'
    )
  })
})
