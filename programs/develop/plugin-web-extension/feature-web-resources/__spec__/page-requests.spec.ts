import {describe, expect, it} from 'vitest'
import {
  collectNamedUnrequestedPages,
  collectReferencedRuntimePayloads
} from '../collect-entry-imports'
import {scanPageRequests} from '../web-resources-lib/page-requests'
import {MAX_SCANNED_SOURCE_BYTES} from '../web-resources-lib/unreachable-resources'

const PAGE = 'pages/x.html'
const emitted = [PAGE, 'pages/other.html', 'engine.wasm']

const requests = (source: string) => scanPageRequests(source).requests(PAGE)

describe('the shapes that build an extension page URL', () => {
  const shapes: Record<string, string> = {
    'a literal': 'el.src = chrome.runtime.getURL("pages/x.html")',
    'a leading slash': "el.src = chrome.runtime.getURL('/pages/x.html')",
    'the browser namespace': 'el.src = browser.runtime.getURL(`pages/x.html`)',
    'a polyfill alias':
      'const api = globalThis.browser || chrome\r\nel.src = api.runtime.getURL("pages/x.html")',
    'a destructured getURL':
      'const {getURL} = chrome.runtime\nel.src = getURL("pages/x.html")',
    'a constant':
      "const P = 'pages/x.html'\r\nconst el = document.createElement('iframe')\r\nel.src = chrome.runtime.getURL(P)",
    'a minified constant':
      'var e="pages/x.html";t.src=chrome.runtime.getURL(e)',
    'a function helper':
      'function url(path) {\n  return chrome.runtime.getURL(path)\n}\nel.src = url("pages/x.html")',
    'an arrow helper':
      'const url = (path) => chrome.runtime.getURL(path)\nel.src = url("pages/x.html")',
    'a bare arrow helper':
      'const url = p => browser.runtime.getURL(p)\nel.src = url("pages/x.html")',
    'a block arrow helper':
      'const url = (path) => {\n  return chrome.runtime.getURL(path)\n}\nel.src = url("pages/x.html")',
    'a helper given a constant':
      'const P = "pages/x.html"\nfunction url(path) { return chrome.runtime.getURL(path) }\nel.src = url(P)',
    'a template on the extension origin':
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the bundle text under test
      'el.src = `chrome-extension://${chrome.runtime.id}/pages/x.html`',
    'a concatenation on runtime.id':
      'el.src = "moz-extension://" + browser.runtime.id + "/pages/x.html"',
    'a concatenation on getURL':
      'el.src = chrome.runtime.getURL("") + "pages/x.html"'
  }

  for (const [name, source] of Object.entries(shapes)) {
    it(`reads ${name} as a request`, () => {
      expect(requests(source)).toBe(true)
      expect(collectReferencedRuntimePayloads(source, emitted)).toEqual([PAGE])
      expect(collectNamedUnrequestedPages(source, emitted)).toEqual([])
    })
  }
})

describe('the shapes that only name an extension page', () => {
  const shapes: Record<string, string> = {
    'a message payload': 'chrome.runtime.sendMessage({open: "pages/x.html"})',
    'a payload beside the extension id':
      'chrome.runtime.sendMessage({from: chrome.runtime.id, open: "pages/x.html"})',
    'a payload beside another getURL call':
      'send({icon: chrome.runtime.getURL("icon.png"), open: "pages/x.html"})',
    'a constant that never reaches getURL':
      'const P = "pages/x.html"\nchrome.runtime.sendMessage({open: P})\nimg.src = chrome.runtime.getURL(icon)',
    'a helper that asks for another file':
      'function url(path) { return chrome.runtime.getURL("icon.png") }\nsend(url("pages/x.html"))',
    'a longer path that ends the same':
      'el.src = chrome.runtime.getURL("old/pages/x.html")\nsend("pages/x.html")'
  }

  for (const [name, source] of Object.entries(shapes)) {
    it(`leaves ${name} unexposed and reports the page`, () => {
      expect(requests(source)).toBe(false)
      expect(collectReferencedRuntimePayloads(source, emitted)).toEqual([])
      expect(collectNamedUnrequestedPages(source, emitted)).toEqual([PAGE])
    })
  }

  it('ignores a request that only a comment makes', () => {
    const source =
      '// el.src = chrome.runtime.getURL("pages/x.html")\r\n/* getURL("pages/x.html") */\r\nsend("pages/x.html")\r\n'

    expect(requests(source)).toBe(false)
    expect(collectReferencedRuntimePayloads(source, emitted)).toEqual([])
    expect(collectNamedUnrequestedPages(source, emitted)).toEqual([PAGE])
  })

  it('stays silent about a page only a comment names', () => {
    const source = '// see pages/x.html\nconsole.log("hello")\n'

    expect(collectReferencedRuntimePayloads(source, emitted)).toEqual([])
    expect(collectNamedUnrequestedPages(source, emitted)).toEqual([])
  })
})

describe('a bundle past the scan budget', () => {
  const padding = `var pad = "${'x'.repeat(MAX_SCANNED_SOURCE_BYTES)}"\n`

  it('keeps a named page exposed, the rule from before the scan existed', () => {
    const source = `${padding}send({open: "pages/x.html"})\n`

    expect(collectReferencedRuntimePayloads(source, emitted)).toEqual([PAGE])
    expect(collectNamedUnrequestedPages(source, emitted)).toEqual([])
  })

  it('still exposes nothing the bundle never names', () => {
    expect(collectReferencedRuntimePayloads(padding, emitted)).toEqual([])
  })
})
