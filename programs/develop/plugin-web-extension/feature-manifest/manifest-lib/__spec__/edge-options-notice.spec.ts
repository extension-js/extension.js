import {afterEach, describe, expect, it, vi} from 'vitest'
import {
  edgeEmbedsOptionsPage,
  reportEdgeEmbeddedOptions,
  resetEdgeOptionsNotice
} from '../edge-options-notice'

const embedded = {options_ui: {page: 'options/index.html', open_in_tab: false}}

describe('Edge embedded options notice', () => {
  afterEach(() => {
    resetEdgeOptionsNotice()
    vi.restoreAllMocks()
  })

  it('flags an Edge options page that stays embedded', () => {
    expect(edgeEmbedsOptionsPage(embedded as any, 'edge')).toBe(true)
    expect(
      edgeEmbedsOptionsPage({options_ui: {page: 'o.html'}} as any, 'edge')
    ).toBe(true)
  })

  it('stays quiet when Edge opens the page in a tab, on other browsers, and with no page', () => {
    expect(
      edgeEmbedsOptionsPage(
        {options_ui: {page: 'o.html', open_in_tab: true}} as any,
        'edge'
      )
    ).toBe(false)

    expect(edgeEmbedsOptionsPage(embedded as any, 'chrome')).toBe(false)
    expect(edgeEmbedsOptionsPage(embedded as any, 'firefox')).toBe(false)
    expect(edgeEmbedsOptionsPage({options_page: 'o.html'} as any, 'edge')).toBe(
      false
    )

    expect(edgeEmbedsOptionsPage({} as any, 'edge')).toBe(false)
  })

  it('prints once per process, naming the edge: prefix remedy', () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })

    reportEdgeEmbeddedOptions(embedded as any, 'edge')
    reportEdgeEmbeddedOptions(embedded as any, 'edge')

    const text = lines.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    expect(text.match(/400px/g)).toHaveLength(1)
    expect(text).toContain('edge:options_ui')
    expect(text).toContain('"open_in_tab": true')
  })
})
