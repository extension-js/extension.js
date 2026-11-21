import {afterEach, describe, expect, it, vi} from 'vitest'
import {asManifest} from '../../__spec__/helpers/manifest-fakes'
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
    expect(edgeEmbedsOptionsPage(embedded, 'edge')).toBe(true)
    expect(
      edgeEmbedsOptionsPage(asManifest({options_ui: {page: 'o.html'}}), 'edge')
    ).toBe(true)
  })

  it('stays quiet when Edge opens the page in a tab, on other browsers, and with no page', () => {
    expect(
      edgeEmbedsOptionsPage(
        asManifest({options_ui: {page: 'o.html', open_in_tab: true}}),
        'edge'
      )
    ).toBe(false)

    expect(edgeEmbedsOptionsPage(embedded, 'chrome')).toBe(false)
    expect(edgeEmbedsOptionsPage(embedded, 'firefox')).toBe(false)
    expect(
      edgeEmbedsOptionsPage(asManifest({options_page: 'o.html'}), 'edge')
    ).toBe(false)

    expect(edgeEmbedsOptionsPage(asManifest({}), 'edge')).toBe(false)
  })

  it('prints once per process, naming the edge: prefix remedy', () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })

    reportEdgeEmbeddedOptions(embedded, 'edge')
    reportEdgeEmbeddedOptions(embedded, 'edge')

    const text = lines.join('\n').replace(/\u001b\[[0-9;]*m/g, '')
    expect(text.match(/400px/g)).toHaveLength(1)
    expect(text).toContain('edge:options_ui')
    expect(text).toContain('"open_in_tab": true')
  })

  it('keeps one latch per browser target, so another target never spends it', () => {
    const lines: string[] = []
    vi.spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line))
    })

    reportEdgeEmbeddedOptions(embedded, 'chrome')
    reportEdgeEmbeddedOptions(embedded, 'firefox')
    expect(lines).toEqual([])

    reportEdgeEmbeddedOptions(embedded, 'edge')
    reportEdgeEmbeddedOptions(embedded, 'chrome')
    reportEdgeEmbeddedOptions(embedded, 'edge')
    expect(lines).toHaveLength(1)

    resetEdgeOptionsNotice()
    reportEdgeEmbeddedOptions(embedded, 'edge')
    expect(lines).toHaveLength(2)
  })
})
