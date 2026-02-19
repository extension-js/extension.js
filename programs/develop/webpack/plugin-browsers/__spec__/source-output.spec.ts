import {describe, expect, it, vi} from 'vitest'
import {
  applySourceRedaction,
  buildHtmlSummary,
  diffDomSnapshots,
  emitActionEvent,
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

describe('emitActionEvent', () => {
  it('uses [HH:mm:ss] timestamp in pretty format', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    emitActionEvent('extension_reload', {reason: 'content'}, 'pretty')

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0]?.[0]).toMatch(
      /^►►► \[\d{2}:\d{2}:\d{2}\] \[action\] extension_reload \{"reason":"content"\}$/
    )
    logSpy.mockRestore()
  })

  it('keeps ISO timestamp in json format', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    emitActionEvent('extension_reload', {reason: 'content'}, 'json')

    expect(logSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0] || '{}'))
    expect(payload.type).toBe('action_event')
    expect(payload.action).toBe('extension_reload')
    expect(payload.reason).toBe('content')
    expect(payload.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
    logSpy.mockRestore()
  })
})
