import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  applyIndependentHtmlSurfaces,
  dropPageAction,
  isPageActionLiveSurface,
  pageActionOutputTarget,
  popupRefsShareSource,
  shouldDropPageAction
} from '../html-surfaces'

const context = '/proj'

describe('popupRefsShareSource', () => {
  it('treats spelling variants of one file as the same source', () => {
    expect(popupRefsShareSource('toolbar.html', './toolbar.html')).toBe(true)
    expect(popupRefsShareSource('/toolbar.html', 'toolbar.html')).toBe(true)
    expect(popupRefsShareSource('toolbar.html', 'address.html')).toBe(false)
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
})
