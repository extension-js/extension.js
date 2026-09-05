import {describe, expect, it} from 'vitest'
import {pageAction} from '../page_action'

describe('page_action override', () => {
  it('names its own page beside a different toolbar popup', () => {
    const out = pageAction({
      browser_action: {default_popup: 'pages/toolbar.html'},
      page_action: {default_popup: 'pages/address.html', default_title: 'x'}
    } as any) as any
    expect(out.page_action.default_popup).toBe('page_action/index.html')
    expect(out.page_action.default_title).toBe('x')
  })

  it('keeps the shared page when both keys name one source', () => {
    const out = pageAction({
      action: {default_popup: 'pages/toolbar.html'},
      page_action: {default_popup: './pages/toolbar.html'}
    } as any) as any
    expect(out.page_action.default_popup).toBe('action/index.html')
  })
})
