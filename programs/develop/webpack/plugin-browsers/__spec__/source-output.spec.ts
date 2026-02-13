import {describe, expect, it} from 'vitest'
import {
  applySourceRedaction,
  buildHtmlSummary,
  diffDomSnapshots,
  formatHtmlSentinelBegin,
  normalizeSourceOutputConfig,
  truncateByBytes
} from '../browsers-lib/source-output'

describe('normalizeSourceOutputConfig', () => {
  it('defaults to json when source enabled', () => {
    const config = normalizeSourceOutputConfig({sourceEnabled: true})
    expect(config.format).toBe('json')
  })

  it('defaults to pretty when source disabled', () => {
    const config = normalizeSourceOutputConfig({sourceEnabled: false})
    expect(config.format).toBe('pretty')
  })
})

describe('applySourceRedaction', () => {
  it('removes script and style blocks in safe mode', () => {
    const html = '<div>ok</div><script>bad()</script><style>.x{}</style>'
    const redacted = applySourceRedaction(html, 'safe')
    expect(redacted).toContain('<div>ok</div>')
    expect(redacted).not.toContain('<script>')
    expect(redacted).not.toContain('<style>')
  })

  it('removes inline event handlers in strict mode', () => {
    const html = '<button onclick="alert(1)" data-id="123">ok</button>'
    const redacted = applySourceRedaction(html, 'strict')
    expect(redacted).toContain('data-id="123"')
    expect(redacted).not.toContain('onclick=')
  })
})

describe('truncateByBytes', () => {
  it('truncates when exceeding max bytes', () => {
    const input = 'abcdefghij'
    const result = truncateByBytes(input, 5)
    expect(result.truncated).toBe(true)
    expect(result.output.length).toBeLessThan(input.length)
  })
})

describe('buildHtmlSummary', () => {
  it('counts extension roots and markers', () => {
    const html =
      '<div id="extension-root"></div><div data-extension-root="true"></div>'
    const summary = buildHtmlSummary(html)
    expect(summary.counts.extensionRoots).toBe(2)
    expect(summary.markers.hasExtensionRootId).toBe(true)
  })
})

describe('formatHtmlSentinelBegin', () => {
  it('builds a sentinel with metadata', () => {
    const sentinel = formatHtmlSentinelBegin({
      url: 'https://example.com',
      title: 'Example',
      stage: 'post_injection',
      truncated: false
    })
    expect(sentinel).toContain('EXTJS_HTML_BEGIN')
    expect(sentinel).toContain('url=')
  })
})

describe('diffDomSnapshots', () => {
  it('detects added and removed nodes', () => {
    const prev = {
      rootMode: 'element',
      depthLimit: 2,
      nodeLimit: 10,
      truncated: false,
      nodes: [{key: 'div[0]', tag: 'div'}]
    }
    const next = {
      rootMode: 'element',
      depthLimit: 2,
      nodeLimit: 10,
      truncated: false,
      nodes: [
        {key: 'div[0]', tag: 'div'},
        {key: 'span[0]', tag: 'span'}
      ]
    }
    const diff = diffDomSnapshots(prev as any, next as any)
    expect(diff.added).toBe(1)
    expect(diff.removed).toBe(0)
  })
})
