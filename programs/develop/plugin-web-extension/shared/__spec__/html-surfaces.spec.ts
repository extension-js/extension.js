import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  applyIndependentHtmlSurfaces,
  browserActionOutputTarget,
  dropPageAction,
  foldBrowserActionIntoAction,
  isBrowserActionLiveSurface,
  isPageActionLiveSurface,
  optionsPageRef,
  pageActionDropReason,
  pageActionOutputTarget,
  popupRefsShareSource,
  shouldDropPageAction,
  shouldFoldBrowserActionIntoAction,
  sidebarActionOutputTarget
} from '../html-surfaces'

const context = '/proj'

describe('popupRefsShareSource', () => {
  it('treats spelling variants of one file as the same source', () => {
    expect(popupRefsShareSource('toolbar.html', './toolbar.html')).toBe(true)
    expect(popupRefsShareSource('/toolbar.html', 'toolbar.html')).toBe(true)
    expect(popupRefsShareSource('toolbar.html', 'address.html')).toBe(false)
  })
})

describe('browser_action under MV3', () => {
  const popup = {default_popup: 'toolbar.html'}

  it('is a live surface only below MV3', () => {
    expect(isBrowserActionLiveSurface({manifest_version: 2} as any)).toBe(true)
    expect(isBrowserActionLiveSurface({manifest_version: 3} as any)).toBe(false)
  })

  it('folds into action when MV3 names no action of its own', () => {
    const manifest = {manifest_version: 3, browser_action: popup} as any
    expect(shouldFoldBrowserActionIntoAction(manifest)).toBe(true)
    const folded = foldBrowserActionIntoAction(manifest) as any
    expect(folded.action).toEqual(popup)
    expect(folded.browser_action).toBeUndefined()
  })

  it('keeps both keys when MV3 already names an action', () => {
    const manifest = {
      manifest_version: 3,
      action: {default_popup: 'action.html'},
      browser_action: popup
    } as any
    expect(shouldFoldBrowserActionIntoAction(manifest)).toBe(false)
    expect(foldBrowserActionIntoAction(manifest)).toBe(manifest)
  })

  it('leaves an MV2 browser_action alone', () => {
    const manifest = {manifest_version: 2, browser_action: popup} as any
    expect(shouldFoldBrowserActionIntoAction(manifest)).toBe(false)
    expect(foldBrowserActionIntoAction(manifest)).toBe(manifest)
  })
})

describe('isPageActionLiveSurface', () => {
  it('is live on every Firefox manifest and only on Chromium MV2', () => {
    expect(
      isPageActionLiveSurface({manifest_version: 3} as any, 'firefox')
    ).toBe(true)

    expect(
      isPageActionLiveSurface({manifest_version: 2} as any, 'chrome')
    ).toBe(true)

    expect(
      isPageActionLiveSurface({manifest_version: 3} as any, 'chrome')
    ).toBe(false)

    expect(isPageActionLiveSurface({manifest_version: 3} as any, 'edge')).toBe(
      false
    )
  })

  it('drops page_action only where the surface is dead', () => {
    const manifest = {
      manifest_version: 3,
      page_action: {default_popup: 'a.html'}
    } as any
    expect(shouldDropPageAction(manifest, 'chrome')).toBe(true)
    expect(shouldDropPageAction(manifest, 'firefox')).toBe(false)
    expect(shouldDropPageAction({manifest_version: 3} as any, 'chrome')).toBe(
      false
    )

    expect(dropPageAction(manifest)).toEqual({manifest_version: 3})
  })

  it('drops page_action beside browser_action on Chromium MV2, not on Firefox', () => {
    const pair = {
      manifest_version: 2,
      browser_action: {default_popup: 'a.html'},
      page_action: {default_popup: 'b.html'}
    } as any
    expect(pageActionDropReason(pair, 'chrome')).toBe('conflicts')
    expect(pageActionDropReason(pair, 'edge')).toBe('conflicts')
    expect(pageActionDropReason(pair, 'firefox')).toBeUndefined()
    expect(
      pageActionDropReason(
        {manifest_version: 2, page_action: {default_popup: 'b.html'}} as any,
        'chrome'
      )
    ).toBeUndefined()

    expect(
      pageActionDropReason(
        {...pair, manifest_version: 3, action: pair.browser_action} as any,
        'chrome'
      )
    ).toBe('unsupported')
  })
})

describe('pageActionOutputTarget', () => {
  it('gives the address bar popup its own page unless it shares the toolbar source', () => {
    expect(
      pageActionOutputTarget({
        browser_action: {default_popup: 'toolbar.html'},
        page_action: {default_popup: 'address.html'}
      } as any)
    ).toBe('page_action/index.html')

    expect(
      pageActionOutputTarget({
        action: {default_popup: 'toolbar.html'},
        page_action: {default_popup: './toolbar.html'}
      } as any)
    ).toBe('action/index.html')
  })

  it('shares the browser_action page when the address bar popup names that source', () => {
    expect(
      pageActionOutputTarget({
        action: {default_popup: 'chrome.html'},
        browser_action: {default_popup: 'firefox.html'},
        page_action: {default_popup: './firefox.html'}
      } as any)
    ).toBe('browser_action/index.html')
  })
})

describe('browserActionOutputTarget', () => {
  it('gives browser_action its own page only beside an action built from another source', () => {
    expect(
      browserActionOutputTarget({
        action: {default_popup: 'chrome.html'},
        browser_action: {default_popup: 'firefox.html'}
      } as any)
    ).toBe('browser_action/index.html')

    expect(
      browserActionOutputTarget({
        action: {default_popup: 'popup.html'},
        browser_action: {default_popup: './popup.html'}
      } as any)
    ).toBe('action/index.html')

    expect(
      browserActionOutputTarget({
        browser_action: {default_popup: 'firefox.html'}
      } as any)
    ).toBe('action/index.html')
  })
})

describe('sidebarActionOutputTarget', () => {
  it('gives sidebar_action its own page only beside a side_panel built from another source', () => {
    expect(
      sidebarActionOutputTarget({
        side_panel: {default_path: 'chrome.html'},
        sidebar_action: {default_panel: 'firefox.html'}
      } as any)
    ).toBe('sidebar_action/index.html')

    expect(
      sidebarActionOutputTarget({
        side_panel: {default_path: 'panel.html'},
        sidebar_action: {default_panel: './panel.html'}
      } as any)
    ).toBe('sidebar/index.html')

    expect(
      sidebarActionOutputTarget({
        sidebar_action: {default_panel: 'firefox.html'}
      } as any)
    ).toBe('sidebar/index.html')
  })
})

describe('applyIndependentHtmlSurfaces', () => {
  it('splits a Firefox pair into two entries', () => {
    const html = applyIndependentHtmlSurfaces(
      {'action/index': '/proj/toolbar.html'},
      {
        manifest_version: 2,
        browser_action: {default_popup: 'toolbar.html'},
        page_action: {default_popup: 'address.html'}
      } as any,
      context,
      'firefox'
    )
    expect(html).toEqual({
      'action/index': path.join(context, 'toolbar.html'),
      'page_action/index': path.join(context, 'address.html')
    })
  })

  it('keeps one entry when both keys name one source', () => {
    const html = applyIndependentHtmlSurfaces(
      {'action/index': '/proj/toolbar.html'},
      {
        manifest_version: 2,
        browser_action: {default_popup: 'toolbar.html'},
        page_action: {default_popup: './toolbar.html'}
      } as any,
      context,
      'firefox'
    )
    expect(html).toEqual({'action/index': path.join(context, 'toolbar.html')})
  })

  it('rebuilds the collapsed slot from the toolbar key when page_action came first', () => {
    const html = applyIndependentHtmlSurfaces(
      {'action/index': '/proj/address.html'},
      {
        manifest_version: 3,
        action: {default_popup: 'toolbar.html'},
        page_action: {default_popup: 'address.html'}
      } as any,
      context,
      'firefox'
    )
    expect(html['action/index']).toBe(path.join(context, 'toolbar.html'))
    expect(html['page_action/index']).toBe(path.join(context, 'address.html'))
  })

  it('leaves the dead surface out on Chromium MV3 and untouched layouts alone', () => {
    const html = applyIndependentHtmlSurfaces(
      {'action/index': '/proj/toolbar.html', 'options/index': '/proj/o.html'},
      {
        manifest_version: 3,
        action: {default_popup: 'toolbar.html'},
        page_action: {default_popup: 'address.html'}
      } as any,
      context,
      'chrome'
    )
    expect(html).toEqual({
      'action/index': path.join(context, 'toolbar.html'),
      'options/index': '/proj/o.html'
    })
  })

  it('splits action and browser_action into two entries when they name two sources', () => {
    const html = applyIndependentHtmlSurfaces(
      {'action/index': '/proj/chrome.html'},
      {
        manifest_version: 3,
        action: {default_popup: 'chrome.html'},
        browser_action: {default_popup: 'firefox.html'}
      } as any,
      context,
      'firefox'
    )
    expect(html).toEqual({
      'action/index': path.join(context, 'chrome.html'),
      'browser_action/index': path.join(context, 'firefox.html')
    })
  })

  it('keeps one toolbar entry when action and browser_action name one source', () => {
    const html = applyIndependentHtmlSurfaces(
      {'action/index': '/proj/popup.html'},
      {
        manifest_version: 3,
        action: {default_popup: 'popup.html'},
        browser_action: {default_popup: './popup.html'}
      } as any,
      context,
      'chrome'
    )
    expect(html).toEqual({'action/index': path.join(context, 'popup.html')})
  })

  it('splits side_panel and sidebar_action into two entries when they name two sources', () => {
    for (const browser of ['firefox', 'chrome']) {
      const html = applyIndependentHtmlSurfaces(
        {'sidebar/index': '/proj/chrome.html'},
        {
          manifest_version: 3,
          side_panel: {default_path: 'chrome.html'},
          sidebar_action: {default_panel: 'firefox.html'}
        } as any,
        context,
        browser
      )
      expect(html).toEqual({
        'sidebar/index': path.join(context, 'chrome.html'),
        'sidebar_action/index': path.join(context, 'firefox.html')
      })
    }
  })

  it('keeps one sidebar entry when both keys name one source or only one is declared', () => {
    const shared = applyIndependentHtmlSurfaces(
      {'sidebar/index': '/proj/panel.html'},
      {
        manifest_version: 3,
        side_panel: {default_path: 'panel.html'},
        sidebar_action: {default_panel: '/panel.html'}
      } as any,
      context,
      'firefox'
    )
    expect(shared).toEqual({'sidebar/index': path.join(context, 'panel.html')})

    const lone = applyIndependentHtmlSurfaces(
      {'sidebar/index': '/proj/panel.html'},
      {
        manifest_version: 2,
        sidebar_action: {default_panel: 'panel.html'}
      } as any,
      context,
      'firefox'
    )
    expect(lone).toEqual({'sidebar/index': path.join(context, 'panel.html')})
  })
})

// Both engines read options_ui.page first and fall back to options_page:
// Chromium parses the legacy key only when options_ui.page gave no URL, and
// Gecko reads `options_ui?.page ?? options_page`.
describe('optionsPageRef', () => {
  it('prefers the modern key when both are declared', () => {
    expect(
      optionsPageRef({
        manifest_version: 3,
        options_page: 'legacy.html',
        options_ui: {page: 'modern.html'}
      } as any)
    ).toBe('modern.html')
  })

  it('falls back to the legacy key when it is the only one declared', () => {
    expect(
      optionsPageRef({manifest_version: 2, options_page: 'legacy.html'} as any)
    ).toBe('legacy.html')
  })

  it('falls back when options_ui carries no page of its own', () => {
    expect(
      optionsPageRef({
        manifest_version: 3,
        options_page: 'legacy.html',
        options_ui: {open_in_tab: true}
      } as any)
    ).toBe('legacy.html')

    expect(
      optionsPageRef({
        manifest_version: 3,
        options_page: 'legacy.html',
        options_ui: {page: '   '}
      } as any)
    ).toBe('legacy.html')
  })

  it('answers nothing when the manifest declares no options page', () => {
    expect(optionsPageRef({manifest_version: 3} as any)).toBeUndefined()
    expect(optionsPageRef(undefined)).toBeUndefined()
  })
})

describe('applyIndependentHtmlSurfaces options slot', () => {
  it('repoints the collapsed slot at the modern source when both are declared', () => {
    const html = applyIndependentHtmlSurfaces(
      {'options/index': path.join(context, 'legacy.html')},
      {
        manifest_version: 3,
        options_page: 'legacy.html',
        options_ui: {page: 'modern.html', open_in_tab: false}
      } as any,
      context,
      'chrome'
    )
    expect(html).toEqual({'options/index': path.join(context, 'modern.html')})
  })

  it('leaves a legacy-only slot exactly where the fields package put it', () => {
    const html = applyIndependentHtmlSurfaces(
      {'options/index': path.join(context, 'legacy.html')},
      {manifest_version: 2, options_page: 'legacy.html'} as any,
      context,
      'chrome'
    )
    expect(html).toEqual({'options/index': path.join(context, 'legacy.html')})
  })

  it('keeps one slot when both keys name the same file', () => {
    const html = applyIndependentHtmlSurfaces(
      {'options/index': path.join(context, 'shared.html')},
      {
        manifest_version: 3,
        options_page: 'shared.html',
        options_ui: {page: './shared.html'}
      } as any,
      context,
      'chrome'
    )
    expect(html).toEqual({'options/index': path.join(context, 'shared.html')})
  })

  it('leaves a modern page hosted in public/ to the copier', () => {
    const html = applyIndependentHtmlSurfaces(
      {'options/index': path.join(context, 'legacy.html')},
      {
        manifest_version: 3,
        options_page: 'legacy.html',
        options_ui: {page: 'public/options.html'}
      } as any,
      context,
      'chrome'
    )
    expect(html['options/index']).toBeUndefined()
  })

  it('leaves a plain popup ref that only the root public/ has to the copier', () => {
    const root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-surfaces-public-'))
    )

    try {
      fs.mkdirSync(path.join(root, 'src'), {recursive: true})
      fs.mkdirSync(path.join(root, 'public', 'app'), {recursive: true})
      fs.writeFileSync(path.join(root, 'src', 'manifest.json'), '{}')
      fs.writeFileSync(path.join(root, 'public', 'app', 'popup.html'), '<p>')

      const srcContext = path.join(root, 'src')
      const html = applyIndependentHtmlSurfaces(
        {'action/index': path.join(srcContext, 'app', 'popup.html')},
        {manifest_version: 3, action: {default_popup: 'app/popup.html'}} as any,
        srcContext,
        'chrome',
        root
      )
      expect(html['action/index']).toBeUndefined()

      const beside = applyIndependentHtmlSurfaces(
        {},
        {manifest_version: 3, action: {default_popup: 'popup.html'}} as any,
        srcContext,
        'chrome',
        root
      )
      expect(beside['action/index']).toBe(path.join(srcContext, 'popup.html'))
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })
})
